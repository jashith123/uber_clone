/**
 * Socket.IO layer.
 *
 * Rooms:
 *   user:<id>              every socket of that user (customer or driver)
 *   drivers:<vehicle_type> online drivers of that class, get `ride:new`
 *
 * Events server -> client:
 *   ride:new        a new request matching the driver's vehicle class
 *   ride:taken      a request left the pool (accepted or cancelled)
 *   ride:update     status/driver changed on a ride the user is part of
 *   driver:location live position of the driver on the customer's ride
 *   chat:message    a new in-ride message (sent to both parties)
 *   call:signal     WebRTC signalling relayed from the other party
 *
 * Events client -> server:
 *   driver:location {lat,lng,heading}                       (drivers only)
 *   driver:rejoin                                            (after vehicle class change)
 *   call:signal     {ride_id, type, payload}  type: offer|answer|ice|end|reject|busy
 */
import { Server } from 'socket.io';
import { verifyToken, loadUser } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { setNotifier } from './services/rides.js';
import { setDriverNotifier, updateDriverLocation } from './services/drivers.js';
import { setChatNotifier, counterpartFor } from './services/chat.js';

const CALL_TYPES = new Set(['offer', 'answer', 'ice', 'end', 'reject', 'busy']);

export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = verifyToken(token);
      const user = loadUser(payload.sub);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    if (user.role === 'driver') {
      socket.join(`drivers:${user.driver?.vehicle_type || 'economy'}`);
      socket.on('driver:location', (loc) => {
        if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
        updateDriverLocation(user.id, loc.lat, loc.lng, Number.isFinite(loc.heading) ? loc.heading : null);
      });
      socket.on('driver:rejoin', () => {
        const fresh = loadUser(user.id);
        for (const room of socket.rooms) if (room.startsWith('drivers:')) socket.leave(room);
        socket.join(`drivers:${fresh?.driver?.vehicle_type || 'economy'}`);
      });
    }

    // WebRTC signalling: relay only between the two parties of an active ride.
    socket.on('call:signal', (msg, ack) => {
      try {
        if (!msg || !CALL_TYPES.has(msg.type)) return ack?.({ error: 'bad signal' });
        const to = counterpartFor(user, Number(msg.ride_id));
        if (!to) return ack?.({ error: 'No active ride with a counterpart' });
        io.to(`user:${to}`).emit('call:signal', {
          ride_id: Number(msg.ride_id),
          from: user.id,
          from_name: user.name,
          type: msg.type,
          payload: msg.payload ?? null,
        });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ error: e.message });
      }
    });
  });

  setNotifier((event, ride) => {
    if (event === 'ride:new') {
      io.to(`drivers:${ride.vehicle_type}`).emit('ride:new', ride);
      return;
    }
    io.to(`user:${ride.customer_id}`).emit('ride:update', ride);
    if (ride.driver_id) io.to(`user:${ride.driver_id}`).emit('ride:update', ride);
    if (ride.status !== 'requested') io.to(`drivers:${ride.vehicle_type}`).emit('ride:taken', { id: ride.id, status: ride.status });
  });

  setDriverNotifier((customerId, loc) => {
    io.to(`user:${customerId}`).emit('driver:location', loc);
  });

  setChatNotifier((ride, msg) => {
    io.to(`user:${ride.customer_id}`).emit('chat:message', msg);
    if (ride.driver_id) io.to(`user:${ride.driver_id}`).emit('chat:message', msg);
  });

  return io;
}

/** Online drivers with a known position, for the customer's "cars nearby" map layer. */
export function nearbyDrivers(lat, lng, vehicleType) {
  const rows = db
    .prepare(
      `SELECT user_id, vehicle_type, lat, lng, heading FROM driver_profiles
       WHERE is_online = 1 AND lat IS NOT NULL AND (? IS NULL OR vehicle_type = ?)`,
    )
    .all(vehicleType || null, vehicleType || null);
  return rows.filter((r) => Math.abs(r.lat - lat) < 0.3 && Math.abs(r.lng - lng) < 0.3);
}
