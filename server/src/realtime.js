/**
 * Socket.IO layer. Every event a client can receive, and everything it may send.
 *
 * Rooms:
 *   user:<id>              every socket of that user
 *   drivers:<vehicle_type> online drivers of that class
 *   admins                 every admin
 *
 * Server -> client:
 *   ride:update      a ride the user is part of changed (their own view of it)
 *   ride:created     confirmation to the rider that the request is live
 *   offer:new        this driver is being offered a ride, with a countdown
 *   offer:expired    that offer timed out
 *   offer:closed     the ride is no longer open (taken or cancelled)
 *   dispatch:searching / dispatch:none   progress of the driver search
 *   driver:location  live position + ETA of the rider's driver
 *   chat:message     new in-ride message
 *   call:signal      WebRTC signalling from the other party
 *   sos:new          an emergency alert (admins only)
 *
 * Client -> server:
 *   driver:location {lat,lng,heading}   (drivers only)
 *   driver:rejoin                        (after a vehicle-class change)
 *   call:signal     {ride_id, type, payload}
 */
import { Server } from 'socket.io';
import { verifyToken, loadUser } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { setNotifier } from './services/rides.js';
import { setDriverNotifier, updateDriverLocation } from './services/drivers.js';
import { setChatNotifier, counterpartFor } from './services/chat.js';
import { setDispatchNotifier } from './services/dispatch.js';
import { setSafetyNotifier } from './services/safety.js';
import { notifyUser } from './services/push.js';

const CALL_TYPES = new Set(['offer', 'answer', 'ice', 'end', 'reject', 'busy']);
const money = (n) => `₹${Math.round(n)}`;

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
    if (user.is_admin) socket.join('admins');

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
        if (msg.type === 'offer') {
          notifyUser(to, { title: 'Incoming call', body: `${user.name} is calling about your ride`, url: '/', tag: 'call' });
        }
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ error: e.message });
      }
    });
  });

  // ---- ride updates: each side gets its own serialised view ----
  setNotifier((event, p) => {
    if (p.forCustomer) io.to(`user:${p.customer_id}`).emit(event, p.forCustomer);
    if (p.driver_id && p.forDriver) io.to(`user:${p.driver_id}`).emit(event, p.forDriver);
    io.to('admins').emit('admin:ride', { id: p.ride_id, status: p.status });

    if (event !== 'ride:update') return;
    const r = p.forCustomer;
    const pushes = {
      accepted: [p.customer_id, { title: 'Driver on the way', body: `${r.driver?.name} is coming in a ${r.driver?.vehicle || 'car'}. PIN ${r.pin}.` }],
      arrived: [p.customer_id, { title: 'Your driver has arrived', body: `${r.driver?.name} is waiting outside. PIN ${r.pin}.` }],
      in_progress: [p.customer_id, { title: 'Trip started', body: `On the way to ${(r.dropoff_address || 'your destination').split(',')[0]}` }],
      completed: [p.customer_id, { title: 'Trip complete', body: `${money(r.fare_final ?? r.fare_estimate)} · rate your driver` }],
    };
    const hit = pushes[p.status];
    if (hit) notifyUser(hit[0], { ...hit[1], url: '/ride', tag: `ride-${p.ride_id}` });
    if (p.status === 'cancelled' && p.driver_id) {
      notifyUser(p.driver_id, { title: 'Ride cancelled', body: 'The rider cancelled this trip.', url: '/drive', tag: `ride-${p.ride_id}` });
    }
  });

  // ---- dispatch ----
  setDispatchNotifier((event, p) => {
    switch (event) {
      case 'offer:new': {
        io.to(`user:${p.driver_id}`).emit('offer:new', p);
        const r = db.prepare('SELECT pickup_address, fare_estimate FROM rides WHERE id = ?').get(p.ride_id);
        notifyUser(p.driver_id, {
          title: `New ride · ${money(r?.fare_estimate || 0)}`,
          body: `${Math.round(p.distance_km * 10) / 10} km away · ${(r?.pickup_address || 'Pickup').split(',')[0]}`,
          url: '/drive',
          tag: `offer-${p.ride_id}`,
        });
        break;
      }
      case 'offer:expired':
        io.to(`user:${p.driver_id}`).emit('offer:expired', p);
        break;
      case 'offer:closed':
        io.emit('offer:closed', p);
        break;
      case 'dispatch:searching':
        io.to(`user:${p.customer_id}`).emit('dispatch:searching', p);
        break;
      case 'dispatch:none':
        io.to(`user:${p.customer_id}`).emit('dispatch:none', p);
        notifyUser(p.customer_id, { title: 'No drivers nearby', body: 'Nobody is free right now. Try again in a minute.', url: '/ride' });
        break;
    }
  });

  setDriverNotifier((customerId, loc) => {
    io.to(`user:${customerId}`).emit('driver:location', loc);
  });

  setChatNotifier((ride, msg) => {
    io.to(`user:${ride.customer_id}`).emit('chat:message', msg);
    if (ride.driver_id) io.to(`user:${ride.driver_id}`).emit('chat:message', msg);
    const to = msg.sender_id === ride.customer_id ? ride.driver_id : ride.customer_id;
    if (to) notifyUser(to, { title: `Message from ${msg.sender_name}`, body: msg.body.slice(0, 120), tag: `chat-${ride.id}` });
  });

  setSafetyNotifier((scope, id, alert) => {
    if (scope === 'admin') {
      io.to(`user:${id}`).emit('sos:new', alert);
      notifyUser(id, { title: '🚨 SOS raised', body: `${alert.user_name} needs help`, url: '/admin/safety', tag: 'sos' });
    }
  });

  return io;
}

/** Online drivers with a known position, for the customer's "cars nearby" map layer. */
export function nearbyDrivers(lat, lng, vehicleType) {
  const rows = db
    .prepare(
      `SELECT user_id, vehicle_type, lat, lng, heading FROM driver_profiles
       WHERE is_online = 1 AND approval_status = 'approved' AND lat IS NOT NULL AND (? IS NULL OR vehicle_type = ?)`,
    )
    .all(vehicleType || null, vehicleType || null);
  return rows.filter((r) => Math.abs(r.lat - lat) < 0.3 && Math.abs(r.lng - lng) < 0.3);
}
