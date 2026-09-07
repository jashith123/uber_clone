/**
 * Ride domain logic: creation, state machine, matching helpers.
 * Realtime notifications are emitted through an injected notifier (see realtime.js)
 * so this module stays testable without sockets.
 */
import { db } from '../db.js';
import { fetchRoutes } from './geo.js';
import { computeFare } from './fare.js';
import { surgeAt } from './surge.js';
import { quotePromo, redeemPromo } from './promos.js';
import { makePin, makeShareToken } from './safety.js';
import { settleRide, settleCancellation } from './payments.js';
import * as dispatch from './dispatch.js';

export const RIDE_STATES = ['requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'];
const ACTIVE_STATES = ['requested', 'accepted', 'arrived', 'in_progress'];

/**
 * Cancellation policy.
 *  - Customer cancels while still `requested`: free.
 *  - Customer cancels within CANCEL_GRACE_SECONDS of the driver accepting: free.
 *  - Customer cancels later, or after the driver has arrived: pays the class cancel_fee (goes to the driver).
 *  - Driver cancels after accepting: DRIVER_CANCEL_PENALTY is deducted from the driver; customer pays nothing.
 */
export const CANCEL_GRACE_SECONDS = 120;
export const DRIVER_CANCEL_PENALTY = 20;

function parseDbTime(s) {
  return s ? Date.parse(s.endsWith('Z') ? s : `${s}Z`) : NaN;
}

/** What a cancellation would cost right now, from each side. */
export function cancelQuote(row, pricing, now = Date.now()) {
  const q = { customer_fee: 0, driver_penalty: 0, grace_ends_at: null };
  if (!row.driver_id || !['accepted', 'arrived'].includes(row.status)) return q;
  q.driver_penalty = DRIVER_CANCEL_PENALTY;
  const acceptedAt = parseDbTime(row.accepted_at);
  const graceEnds = acceptedAt + CANCEL_GRACE_SECONDS * 1000;
  q.grace_ends_at = new Date(graceEnds).toISOString();
  if (row.status === 'arrived' || now >= graceEnds) q.customer_fee = pricing?.cancel_fee ?? 0;
  return q;
}

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
      distance_km, duration_min, fare_estimate, fare_breakdown, currency, payment_method,
      pin, share_token, surge_multiplier, promo_code, discount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  event: db.prepare('INSERT INTO ride_events (ride_id, actor_id, type, payload) VALUES (?,?,?,?)'),
  user: db.prepare('SELECT id, name, phone, role FROM users WHERE id = ?'),
  driverProfile: db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?'),
  setEta: db.prepare('UPDATE rides SET driver_eta_min = ? WHERE id = ?'),
};

export function logEvent(rideId, actorId, type, payload) {
  stmts.event.run(rideId, actorId ?? null, type, payload ? JSON.stringify(payload) : null);
}

/**
 * Hydrate a ride row into the API shape.
 * `viewerId` decides who may see the PIN: the rider always, the driver never
 * (they have to be told it), so the PIN actually proves identity.
 */
export function serializeRide(row, viewerId = null) {
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
  const isRider = viewerId == null || viewerId === row.customer_id;
  return {
    ...row,
    pin: isRider ? row.pin : null,
    pin_required: Boolean(row.pin),
    waypoints: JSON.parse(row.waypoints),
    route_geometry: JSON.parse(row.route_geometry),
    fare_breakdown: JSON.parse(row.fare_breakdown),
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
    driver,
    cancel_policy: cancelQuote(row, stmts.pricing.get(row.vehicle_type)),
  };
}

export function getRide(id, viewerId = null) {
  return serializeRide(stmts.ride.get(id), viewerId);
}

export function activeRideForUser(user) {
  const row = user.role === 'driver' ? stmts.activeForDriver.get(user.id) : stmts.activeForCustomer.get(user.id);
  return serializeRide(row, user.id);
}

/** Both sides of a ride, each seeing their own view. */
function broadcast(rideId, event = 'ride:update') {
  const row = stmts.ride.get(rideId);
  if (!row) return null;
  notify(event, {
    ride_id: rideId,
    customer_id: row.customer_id,
    driver_id: row.driver_id,
    vehicle_type: row.vehicle_type,
    status: row.status,
    forCustomer: serializeRide(row, row.customer_id),
    forDriver: row.driver_id ? serializeRide(row, row.driver_id) : null,
  });
  return row;
}

/**
 * Create a ride from the customer's chosen waypoints + route alternative.
 * The server re-requests the route so distance and fare are computed from
 * trusted data, never from numbers the client sent.
 */
export async function createRide(customer, body) {
  const { waypoints, route_index = 0, vehicle_type, payment_method = 'cash', promo_code = null } = body || {};
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
  if (route.distance_km < 0.2) {
    throw Object.assign(new Error('Pickup and drop-off are too close together'), { status: 400 });
  }

  const pickup = waypoints[0];
  const surge = surgeAt({ lat: pickup.lat, lng: pickup.lng }, vehicle_type);

  // Price once without a discount to judge the promo against the real fare.
  const gross = computeFare(pricing, route.distance_km, route.duration_min, {
    surge: surge.multiplier,
    surgeReason: surge.reason,
  });
  const promo = promo_code ? quotePromo(customer, promo_code, gross.total) : { ok: false, discount: 0 };
  if (promo_code && !promo.ok) throw Object.assign(new Error(promo.reason), { status: 400 });

  const { total, breakdown } = computeFare(pricing, route.distance_km, route.duration_min, {
    surge: surge.multiplier,
    surgeReason: surge.reason,
    discount: promo.discount,
    promoCode: promo.ok ? promo.code : null,
  });

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
    makePin(),
    makeShareToken(),
    surge.multiplier,
    promo.ok ? promo.code : null,
    promo.discount || 0,
  );
  const rideId = Number(result.lastInsertRowid);
  if (promo.ok) redeemPromo(customer, promo.code, rideId, promo.discount);

  logEvent(rideId, customer.id, 'requested', { fare: total, distance_km: route.distance_km, surge: surge.multiplier, promo: promo.ok ? promo.code : null });
  broadcast(rideId, 'ride:created');
  dispatch.startDispatch(rideId);
  return getRide(rideId, customer.id);
}

/** The rides a driver is currently being offered (dispatch decides, not the driver). */
export function availableRides(driver) {
  const offers = dispatch.offersForDriver(driver.id);
  return offers
    .map((o) => {
      const ride = getRide(o.ride_id, driver.id);
      if (!ride || ride.status !== 'requested') return null;
      return {
        ...ride,
        offer_id: o.id,
        offer_expires_at: o.expires_at,
        pickup_distance_km: o.distance_km,
        wave: o.wave,
      };
    })
    .filter(Boolean);
}

/** Atomic accept: only succeeds if the ride is still `requested` and it was offered to them. */
export function acceptRide(driver, rideId) {
  if (!driver.driver?.is_online) throw Object.assign(new Error('Go online before accepting rides'), { status: 409 });
  if (driver.driver?.approval_status && driver.driver.approval_status !== 'approved') {
    throw Object.assign(new Error('Your account is still being reviewed'), { status: 403 });
  }
  if (stmts.activeForDriver.get(driver.id)) {
    throw Object.assign(new Error('Finish your current ride first'), { status: 409 });
  }
  if (!dispatch.hasOffer(rideId, driver.id)) {
    throw Object.assign(new Error('That request is no longer offered to you'), { status: 409 });
  }
  const res = db
    .prepare(`UPDATE rides SET driver_id = ?, status = 'accepted', accepted_at = datetime('now') WHERE id = ? AND status = 'requested'`)
    .run(driver.id, rideId);
  if (res.changes === 0) {
    const existing = stmts.ride.get(rideId);
    if (!existing) throw Object.assign(new Error('Ride not found'), { status: 404 });
    throw Object.assign(new Error('Ride was already taken or cancelled'), { status: 409 });
  }
  dispatch.markAccepted(driver.id, rideId);
  logEvent(rideId, driver.id, 'accepted');
  broadcast(rideId);
  return getRide(rideId, driver.id);
}

export function declineRide(driver, rideId) {
  const out = dispatch.declineOffer(driver.id, rideId);
  logEvent(rideId, driver.id, 'declined');
  return out;
}

const TRANSITIONS = {
  arrived: { from: ['accepted'], col: 'arrived_at' },
  in_progress: { from: ['arrived', 'accepted'], col: 'started_at' },
  completed: { from: ['in_progress'], col: 'completed_at' },
};

/** Driver-only forward transitions. Starting a trip needs the rider's PIN. */
export function advanceRide(driver, rideId, nextStatus, { pin } = {}) {
  const t = TRANSITIONS[nextStatus];
  if (!t) throw Object.assign(new Error('Invalid transition'), { status: 400 });
  const ride = stmts.ride.get(rideId);
  if (!ride) throw Object.assign(new Error('Ride not found'), { status: 404 });
  if (ride.driver_id !== driver.id) throw Object.assign(new Error('Not your ride'), { status: 403 });
  if (!t.from.includes(ride.status)) {
    throw Object.assign(new Error(`Cannot move from ${ride.status} to ${nextStatus}`), { status: 409 });
  }
  if (nextStatus === 'in_progress' && ride.pin) {
    if (String(pin || '').trim() !== ride.pin) {
      throw Object.assign(new Error('Wrong PIN. Ask the rider for the 4 digits shown on their screen.'), { status: 400 });
    }
  }

  const placeholders = t.from.map(() => '?').join(',');
  const extra = nextStatus === 'completed' ? ', fare_final = fare_estimate' : '';
  db.prepare(`UPDATE rides SET status = ?, ${t.col} = datetime('now')${extra} WHERE id = ? AND status IN (${placeholders})`).run(
    nextStatus,
    rideId,
    ...t.from,
  );

  if (nextStatus === 'completed') {
    const fresh = stmts.ride.get(rideId);
    try {
      settleRide(fresh);
    } catch (e) {
      // Not enough wallet balance: the trip still ends, the amount is left owing.
      logEvent(rideId, driver.id, 'settle_failed', { error: e.message });
      db.prepare(`UPDATE rides SET payment_status = 'failed' WHERE id = ?`).run(rideId);
    }
  }

  logEvent(rideId, driver.id, nextStatus);
  broadcast(rideId);
  return getRide(rideId, driver.id);
}

export function cancelRide(user, rideId, reason) {
  const ride = stmts.ride.get(rideId);
  if (!ride) throw Object.assign(new Error('Ride not found'), { status: 404 });
  const isParty = ride.customer_id === user.id || ride.driver_id === user.id;
  if (!isParty) throw Object.assign(new Error('Not your ride'), { status: 403 });
  if (!['requested', 'accepted', 'arrived'].includes(ride.status)) {
    throw Object.assign(new Error(`Cannot cancel a ride that is ${ride.status}`), { status: 409 });
  }
  const quote = cancelQuote(ride, stmts.pricing.get(ride.vehicle_type));
  const cancelFee = user.role === 'customer' ? quote.customer_fee : 0;
  const driverPenalty = user.role === 'driver' ? quote.driver_penalty : 0;
  db.prepare(
    `UPDATE rides SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ?, cancelled_by = ?,
       cancel_fee = ?, driver_penalty = ? WHERE id = ?`,
  ).run(reason || null, user.role, cancelFee, driverPenalty, rideId);

  dispatch.stopDispatch(rideId);
  settleCancellation(stmts.ride.get(rideId));

  logEvent(rideId, user.id, 'cancelled', { by: user.role, reason, cancel_fee: cancelFee, driver_penalty: driverPenalty });

  // A driver dropping out mid-ride puts the rider back in the queue.
  if (user.role === 'driver' && ['accepted', 'arrived'].includes(ride.status)) {
    const re = db
      .prepare(`UPDATE rides SET status = 'requested', driver_id = NULL, accepted_at = NULL, arrived_at = NULL,
                cancelled_at = NULL, cancel_reason = NULL, cancelled_by = NULL, cancel_fee = 0 WHERE id = ?`)
      .run(rideId);
    if (re.changes) {
      logEvent(rideId, user.id, 'requeued', { after: 'driver_cancel' });
      broadcast(rideId);
      dispatch.startDispatch(rideId);
      return getRide(rideId, user.id);
    }
  }

  broadcast(rideId);
  return getRide(rideId, user.id);
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
  return getRide(rideId, user.id);
}

export function listRides(user, { limit = 50 } = {}) {
  const col = user.role === 'driver' ? 'driver_id' : 'customer_id';
  return db
    .prepare(`SELECT * FROM rides WHERE ${col} = ? ORDER BY id DESC LIMIT ?`)
    .all(user.id, limit)
    .map((r) => serializeRide(r, user.id));
}

/** Store the driver's live minutes-to-pickup so the rider can see it. */
export function setEta(rideId, minutes) {
  stmts.setEta.run(minutes, rideId);
}

export function isActiveStatus(s) {
  return ACTIVE_STATES.includes(s);
}
