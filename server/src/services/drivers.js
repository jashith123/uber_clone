/**
 * Driver location tracking and the live "minutes away" figure the rider sees.
 *
 * A real road ETA needs a routing call, which is far too heavy to do on every
 * GPS ping, so it is recomputed at most every ETA_INTERVAL_MS per ride and a
 * straight-line estimate is used in between.
 */
import { db } from '../db.js';
import { fetchRoutes } from './geo.js';
import { setEta } from './rides.js';

const ETA_INTERVAL_MS = 25000;
const lastEtaAt = new Map(); // rideId -> timestamp

let notify = () => {};
export function setDriverNotifier(fn) {
  notify = fn;
}

const update = db.prepare(
  `UPDATE driver_profiles SET lat = ?, lng = ?, heading = ?, location_at = datetime('now') WHERE user_id = ?`,
);
const activeRide = db.prepare(
  `SELECT id, customer_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
   FROM rides WHERE driver_id = ? AND status IN ('accepted','arrived','in_progress') ORDER BY id DESC LIMIT 1`,
);

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Persist a driver's position and push it, with an ETA, to the rider. */
export function updateDriverLocation(driverId, lat, lng, heading) {
  update.run(lat, lng, heading, driverId);
  const ride = activeRide.get(driverId);
  if (!ride) return;

  const target =
    ride.status === 'in_progress'
      ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng }
      : { lat: ride.pickup_lat, lng: ride.pickup_lng };
  const straightKm = haversineKm({ lat, lng }, target);
  // 22 km/h average city speed, and roads are longer than the crow flies (x1.35).
  const roughMin = Math.max(1, Math.round(((straightKm * 1.35) / 22) * 60));

  notify(ride.customer_id, {
    ride_id: ride.id,
    driver_id: driverId,
    lat,
    lng,
    heading,
    eta_min: roughMin,
    distance_km: Math.round(straightKm * 100) / 100,
  });

  const last = lastEtaAt.get(ride.id) || 0;
  if (Date.now() - last > ETA_INTERVAL_MS && straightKm < 40) {
    lastEtaAt.set(ride.id, Date.now());
    fetchRoutes([{ lat, lng }, target])
      .then((routes) => {
        const min = Math.round(routes[0].duration_min);
        setEta(ride.id, min);
        notify(ride.customer_id, { ride_id: ride.id, driver_id: driverId, lat, lng, heading, eta_min: min, road: true });
      })
      .catch(() => {
        setEta(ride.id, roughMin);
      });
  }
}

export function forgetRideEta(rideId) {
  lastEtaAt.delete(rideId);
}
