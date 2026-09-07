/**
 * Dispatch engine.
 *
 * Instead of showing every request to every online driver, a new ride is offered
 * in waves to the nearest few drivers, each of whom has a short window to accept:
 *
 *   wave 1: the 3 nearest approved, online, free drivers within 3 km, 20 s each
 *   wave 2: same, within 6 km, for drivers not already offered this ride
 *   wave 3: within 10 km
 *   then:   no drivers found, the rider is told
 *
 * The first driver to accept wins (the accept itself is an atomic UPDATE in
 * services/rides.js); everyone else's offer is marked cancelled.
 *
 * Timers live in memory. On restart, `resumePendingDispatch()` picks up any ride
 * that was still searching.
 */
import { db } from '../db.js';
import { config } from '../config.js';

const timers = new Map(); // rideId -> Timeout

let notify = () => {};
/** Wired to Socket.IO in realtime.js: (event, payload) => void */
export function setDispatchNotifier(fn) {
  notify = fn;
}

const stmts = {
  ride: db.prepare('SELECT * FROM rides WHERE id = ?'),
  freeDrivers: db.prepare(`
    SELECT p.user_id, p.lat, p.lng, p.vehicle_type, p.rating, p.acceptance_rate
    FROM driver_profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.is_online = 1
      AND p.approval_status = 'approved'
      AND u.is_blocked = 0
      AND p.lat IS NOT NULL
      AND p.vehicle_type = ?
      AND p.user_id NOT IN (SELECT driver_id FROM rides WHERE driver_id IS NOT NULL AND status IN ('accepted','arrived','in_progress'))
      AND p.user_id NOT IN (SELECT driver_id FROM ride_offers WHERE ride_id = ? AND status IN ('offered','declined'))
      AND p.user_id NOT IN (SELECT driver_id FROM ride_offers WHERE status = 'offered' AND expires_at > datetime('now'))`),
  addOffer: db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at)
                        VALUES (?,?,?,?, datetime('now', '+' || ? || ' seconds'))`),
  openOffers: db.prepare(`SELECT * FROM ride_offers WHERE ride_id = ? AND status = 'offered'`),
  offerFor: db.prepare(`SELECT * FROM ride_offers WHERE ride_id = ? AND driver_id = ? AND status = 'offered'`),
  expireWave: db.prepare(`UPDATE ride_offers SET status = 'expired', responded_at = datetime('now') WHERE ride_id = ? AND status = 'offered'`),
  cancelOffers: db.prepare(`UPDATE ride_offers SET status = 'cancelled', responded_at = datetime('now') WHERE ride_id = ? AND status = 'offered'`),
  declineOffer: db.prepare(`UPDATE ride_offers SET status = 'declined', responded_at = datetime('now') WHERE id = ?`),
  acceptOffer: db.prepare(`UPDATE ride_offers SET status = 'accepted', responded_at = datetime('now') WHERE id = ?`),
  myOffers: db.prepare(`SELECT * FROM ride_offers WHERE driver_id = ? AND status = 'offered' AND expires_at > datetime('now') ORDER BY id DESC`),
  setState: db.prepare('UPDATE rides SET dispatch_state = ? WHERE id = ?'),
  seen: db.prepare('UPDATE driver_profiles SET offers_seen = offers_seen + 1 WHERE user_id = ?'),
  taken: db.prepare('UPDATE driver_profiles SET offers_taken = offers_taken + 1 WHERE user_id = ?'),
  rate: db.prepare(`UPDATE driver_profiles
                    SET acceptance_rate = CASE WHEN offers_seen = 0 THEN 100 ELSE round(offers_taken * 100.0 / offers_seen, 1) END
                    WHERE user_id = ?`),
  searching: db.prepare(`SELECT id FROM rides WHERE status = 'requested' AND dispatch_state = 'searching'`),
};

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Public: the offers a driver is currently being asked to answer. */
export function offersForDriver(driverId) {
  return stmts.myOffers.all(driverId);
}

export function hasOffer(rideId, driverId) {
  return Boolean(stmts.offerFor.get(rideId, driverId));
}

/** Begin (or continue) searching for a driver for this ride. */
export function startDispatch(rideId, wave = 1) {
  clearTimer(rideId);
  const ride = stmts.ride.get(rideId);
  if (!ride || ride.status !== 'requested') return;

  if (wave > config.dispatch.maxWaves) {
    stmts.setState.run('no_drivers', rideId);
    notify('dispatch:none', { ride_id: rideId, customer_id: ride.customer_id });
    return;
  }

  const radius = config.dispatch.radiiKm[Math.min(wave - 1, config.dispatch.radiiKm.length - 1)];
  const pickup = { lat: ride.pickup_lat, lng: ride.pickup_lng };

  const candidates = stmts.freeDrivers
    .all(ride.vehicle_type, rideId)
    .map((d) => ({ ...d, distance_km: haversineKm(pickup, d) }))
    .filter((d) => d.distance_km <= radius)
    // nearest first, but a driver who accepts more often breaks ties
    .sort((a, b) => a.distance_km - b.distance_km || b.acceptance_rate - a.acceptance_rate)
    .slice(0, config.dispatch.driversPerWave);

  stmts.setState.run('searching', rideId);

  if (candidates.length === 0) {
    // Nobody in this ring: widen immediately rather than waiting out the clock.
    const t = setTimeout(() => startDispatch(rideId, wave + 1), 1500);
    timers.set(rideId, t);
    return;
  }

  const seconds = config.dispatch.offerSeconds;
  for (const d of candidates) {
    stmts.addOffer.run(rideId, d.user_id, wave, Math.round(d.distance_km * 100) / 100, seconds);
    stmts.seen.run(d.user_id);
    stmts.rate.run(d.user_id);
    notify('offer:new', { driver_id: d.user_id, ride_id: rideId, wave, expires_in: seconds, distance_km: d.distance_km });
  }
  notify('dispatch:searching', { ride_id: rideId, customer_id: ride.customer_id, wave, offered_to: candidates.length });

  const t = setTimeout(() => {
    stmts.expireWave.run(rideId);
    for (const d of candidates) {
      notify('offer:expired', { driver_id: d.user_id, ride_id: rideId });
      stmts.rate.run(d.user_id);
    }
    startDispatch(rideId, wave + 1);
  }, seconds * 1000 + 500);
  timers.set(rideId, t);
}

/** A driver said no: retire their offer and, if the wave is empty, widen at once. */
export function declineOffer(driverId, rideId) {
  const offer = stmts.offerFor.get(rideId, driverId);
  if (!offer) throw Object.assign(new Error('That offer is no longer open'), { status: 409 });
  stmts.declineOffer.run(offer.id);
  stmts.rate.run(driverId);
  const remaining = stmts.openOffers.all(rideId).length;
  if (remaining === 0) startDispatch(rideId, offer.wave + 1);
  return { ok: true, remaining };
}

/** Called by rides.acceptRide once the ride row is safely assigned. */
export function markAccepted(driverId, rideId) {
  const offer = stmts.offerFor.get(rideId, driverId);
  if (offer) {
    stmts.acceptOffer.run(offer.id);
    stmts.taken.run(driverId);
    stmts.rate.run(driverId);
  }
  stmts.cancelOffers.run(rideId);
  stmts.setState.run('idle', rideId);
  clearTimer(rideId);
  notify('offer:closed', { ride_id: rideId });
}

/** Ride cancelled or otherwise finished while still searching. */
export function stopDispatch(rideId) {
  stmts.cancelOffers.run(rideId);
  stmts.setState.run('idle', rideId);
  clearTimer(rideId);
  notify('offer:closed', { ride_id: rideId });
}

function clearTimer(rideId) {
  const t = timers.get(rideId);
  if (t) clearTimeout(t);
  timers.delete(rideId);
}

/** After a restart, resume searching for rides that were mid-dispatch. */
export function resumePendingDispatch() {
  const rows = stmts.searching.all();
  for (const r of rows) {
    stmts.expireWave.run(r.id);
    startDispatch(r.id, 1);
  }
  return rows.length;
}

/** Admin/debug view. */
export function offersForRide(rideId) {
  return db.prepare(`
    SELECT o.*, u.name AS driver_name FROM ride_offers o
    JOIN users u ON u.id = o.driver_id WHERE o.ride_id = ? ORDER BY o.id`).all(rideId);
}
