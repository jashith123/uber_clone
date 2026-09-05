/**
 * Ride domain logic: creation, state machine, matching helpers.
 * Realtime notifications are emitted through an injected `emit` (see realtime.js)
 * so this module stays testable without sockets.
 */
import { db } from '../db.js';
import { fetchRoutes } from './geo.js';
import { computeFare } from './fare.js';

export const RIDE_STATES = ['requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'];
const ACTIVE_STATES = ['requested', 'accepted', 'arrived', 'in_progress'];

let notify = () => {};
export function setNotifier(fn) {
  notify = fn;
}

const stmts = {
  pricing: db.prepare('SELECT * FROM pricing WHERE vehicle_type = ?'),
  ride: db.prepare('SELECT * FROM rides WHERE id = ?'),
  activeForCustomer: db.prepare(
    `SELECT * FROM rides WHERE customer_id = ? AND status IN ('requested','accepted','arrived','in_progress') ORDER BY id DESC LIMIT 1`,
  ),
  activeForDriver: db.prepare(
    `SELECT * FROM rides WHERE driver_id = ? AND status IN ('accepted','arrived','in_progress') ORDER BY id DESC LIMIT 1`,
  ),
  insert: db.prepare(`
    INSERT INTO rides (customer_id, vehicle_type, pickup_lat, pickup_lng, pickup_address,
      dropoff_lat, dropoff_lng, dropoff_address, waypoints, route_index, route_geometry,
      distance_km, duration_min, fare_estimate, fare_breakdown, currency, payment_method)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  event: db.prepare('INSERT INTO ride_events (ride_id, actor_id, type, payload) VALUES (?,?,?,?)'),
  user: db.prepare('SELECT id, name, phone, role FROM users WHERE id = ?'),
  driverProfile: db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?'),
};

export function logEvent(rideId, actorId, type, payload) {
  stmts.event.run(rideId, actorId ?? null, type, payload ? JSON.stringify(payload) : null);
}

/** Hydrate a ride row into the API shape (parsed JSON + participants). */
export function serializeRide(row) {
  if (!row) return null;
  const customer = stmts.user.get(row.customer_id);
  let driver = null;
  if (row.driver_id) {
    const u = stmts.user.get(row.driver_id);
    const p = stmts.driverProfile.get(row.driver_id);
    driver = u
      ? {
          id: u.id,
          name: u.name,
          phone: u.phone,
          vehicle_type: p?.vehicle_type,
          vehicle: p ? [p.vehicle_color, p.vehicle_make, p.vehicle_model].filter(Boolean).join(' ') : null,
          plate: p?.plate,
          rating: p?.rating ?? 5,
          lat: p?.lat ?? null,
          lng: p?.lng ?? null,
          heading: p?.heading ?? null,
        }
      : null;
  }
  return {
    ...row,
    waypoints: JSON.parse(row.waypoints),
    route_geometry: JSON.parse(row.route_geometry),
    fare_breakdown: JSON.parse(row.fare_breakdown),
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
    driver,
  };
}

export function getRide(id) {
  return serializeRide(stmts.ride.get(id));
}

export function activeRideForUser(user) {
  const row = user.role === 'driver' ? stmts.activeForDriver.get(user.id) : stmts.activeForCustomer.get(user.id);
  return serializeRide(row);
}

/**
 * Create a ride from the customer's chosen waypoints + route alternative.
 * The server re-requests the route so distance and fare are computed from
 * trusted data, never from numbers the client sent.
 */
export async function createRide(customer, body) {
  const { waypoints, route_index = 0, vehicle_type, payment_method = 'cash' } = body || {};
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw Object.assign(new Error('waypoints must contain pickup and dropoff'), { status: 400 });
  }
  for (const w of waypoints) {
    if (typeof w?.lat !== 'number' || typeof w?.lng !== 'number') {
      throw Object.assign(new Error('Each waypoint needs numeric lat and lng'), { status: 400 });
    }
  }
  const pricing = stmts.pricing.get(vehicle_type);
  if (!pricing) throw Object.assign(new Error('Unknown vehicle type'), { status: 400 });
  if (!['cash', 'card', 'wallet'].includes(payment_method)) {
    throw Object.assign(new Error('Unsupported payment method'), { status: 400 });
  }
  if (stmts.activeForCustomer.get(customer.id)) {
    throw Object.assign(new Error('You already have an active ride'), { status: 409 });
  }

  const routes = await fetchRoutes(waypoints);
  const route = routes[Math.min(Math.max(0, Number(route_index) || 0), routes.length - 1)];
  const { total, breakdown } = computeFare(pricing, route.distance_km, route.duration_min);

  const pickup = waypoints[0];
  const dropoff = waypoints[waypoints.length - 1];
  const result = stmts.insert.run(
    customer.id,
    vehicle_type,
    pickup.lat,
    pickup.lng,
    pickup.address || null,
    dropoff.lat,
    dropoff.lng,
    dropoff.address || null,
    JSON.stringify(waypoints.map((w) => ({ lat: w.lat, lng: w.lng, address: w.address || null }))),
    route.index,
    JSON.stringify(route.geometry),
    route.distance_km,
    route.duration_min,
    total,
    JSON.stringify(breakdown),
    pricing.currency,
    payment_method,
  );
  const ride = getRide(Number(result.lastInsertRowid));
  logEvent(ride.id, customer.id, 'requested', { fare: total, distance_km: route.distance_km });
  notify('ride:new', ride);
  return ride;
}

/** Rides a driver can pick up: requested, matching their vehicle class, newest first. */
export function availableRides(driver, limit = 20) {
  const type = driver.driver?.vehicle_type || 'economy';
  const rows = db
    .prepare(`SELECT * FROM rides WHERE status = 'requested' AND vehicle_type = ? ORDER BY id DESC LIMIT ?`)
    .all(type, limit);
  const rides = rows.map(serializeRide);
  if (driver.driver?.lat != null && driver.driver?.lng != null) {
    for (const r of rides) {
      r.pickup_distance_km = haversine(driver.driver, { lat: r.pickup_lat, lng: r.pickup_lng });
    }
    rides.sort((a, b) => a.pickup_distance_km - b.pickup_distance_km);
  }
  return rides;
}

function haversine(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Atomic accept: only succeeds if the ride is still `requested`. */
export function acceptRide(driver, rideId) {
  if (!driver.driver?.is_online) throw Object.assign(new Error('Go online before accepting rides'), { status: 409 });
  if (stmts.activeForDriver.get(driver.id)) {
    throw Object.assign(new Error('Finish your current ride first'), { status: 409 });
  }
  const res = db
    .prepare(`UPDATE rides SET driver_id = ?, status = 'accepted', accepted_at = datetime('now') WHERE id = ? AND status = 'requested'`)
    .run(driver.id, rideId);
  if (res.changes === 0) {
    const existing = stmts.ride.get(rideId);
    if (!existing) throw Object.assign(new Error('Ride not found'), { status: 404 });
    throw Object.assign(new Error('Ride was already taken or cancelled'), { status: 409 });
  }
  const ride = getRide(rideId);
  logEvent(rideId, driver.id, 'accepted');
  notify('ride:update', ride);
  return ride;
}

const TRANSITIONS = {
  arrived: { from: ['accepted'], col: 'arrived_at' },
  in_progress: { from: ['arrived', 'accepted'], col: 'started_at' },
  completed: { from: ['in_progress'], col: 'completed_at' },
};

/** Driver-only forward transitions. */
export function advanceRide(driver, rideId, nextStatus) {
  const t = TRANSITIONS[nextStatus];
  if (!t) throw Object.assign(new Error('Invalid transition'), { status: 400 });
  const ride = stmts.ride.get(rideId);
  if (!ride) throw Object.assign(new Error('Ride not found'), { status: 404 });
  if (ride.driver_id !== driver.id) throw Object.assign(new Error('Not your ride'), { status: 403 });
  if (!t.from.includes(ride.status)) {
    throw Object.assign(new Error(`Cannot move from ${ride.status} to ${nextStatus}`), { status: 409 });
  }
  const placeholders = t.from.map(() => '?').join(',');
  const extra = nextStatus === 'completed' ? ', fare_final = fare_estimate' : '';
  db.prepare(`UPDATE rides SET status = ?, ${t.col} = datetime('now')${extra} WHERE id = ? AND status IN (${placeholders})`).run(
    nextStatus,
    rideId,
    ...t.from,
  );
  const updated = getRide(rideId);
  logEvent(rideId, driver.id, nextStatus);
  notify('ride:update', updated);
  return updated;
}

export function cancelRide(user, rideId, reason) {
  const ride = stmts.ride.get(rideId);
  if (!ride) throw Object.assign(new Error('Ride not found'), { status: 404 });
  const isParty = ride.customer_id === user.id || ride.driver_id === user.id;
  if (!isParty) throw Object.assign(new Error('Not your ride'), { status: 403 });
  if (!['requested', 'accepted', 'arrived'].includes(ride.status)) {
    throw Object.assign(new Error(`Cannot cancel a ride that is ${ride.status}`), { status: 409 });
  }
  db.prepare(
    `UPDATE rides SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ?, cancelled_by = ? WHERE id = ?`,
  ).run(reason || null, user.role, rideId);
  const updated = getRide(rideId);
  logEvent(rideId, user.id, 'cancelled', { by: user.role, reason });
  notify('ride:update', updated);
  return updated;
}

export function rateRide(user, rideId, stars) {
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw Object.assign(new Error('Rating must be 1-5'), { status: 400 });
  const ride = stmts.ride.get(rideId);
  if (!ride) throw Object.assign(new Error('Ride not found'), { status: 404 });
  if (ride.status !== 'completed') throw Object.assign(new Error('Only completed rides can be rated'), { status: 409 });
  if (user.role === 'customer' && ride.customer_id === user.id) {
    if (ride.driver_rating) throw Object.assign(new Error('Already rated'), { status: 409 });
    db.prepare('UPDATE rides SET driver_rating = ? WHERE id = ?').run(n, rideId);
    db.prepare(
      `UPDATE driver_profiles SET rating = ((rating * rating_count) + ?) / (rating_count + 1), rating_count = rating_count + 1 WHERE user_id = ?`,
    ).run(n, ride.driver_id);
  } else if (user.role === 'driver' && ride.driver_id === user.id) {
    if (ride.customer_rating) throw Object.assign(new Error('Already rated'), { status: 409 });
    db.prepare('UPDATE rides SET customer_rating = ? WHERE id = ?').run(n, rideId);
  } else {
    throw Object.assign(new Error('Not your ride'), { status: 403 });
  }
  logEvent(rideId, user.id, 'rated', { stars: n, by: user.role });
  return getRide(rideId);
}

export function listRides(user, { limit = 50 } = {}) {
  const col = user.role === 'driver' ? 'driver_id' : 'customer_id';
  return db
    .prepare(`SELECT * FROM rides WHERE ${col} = ? ORDER BY id DESC LIMIT ?`)
    .all(user.id, limit)
    .map(serializeRide);
}

export function isActiveStatus(s) {
  return ACTIVE_STATES.includes(s);
}
