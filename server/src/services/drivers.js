import { db } from '../db.js';

let notify = () => {};
export function setDriverNotifier(fn) {
  notify = fn;
}

const update = db.prepare(
  `UPDATE driver_profiles SET lat = ?, lng = ?, heading = ?, location_at = datetime('now') WHERE user_id = ?`,
);
const activeRide = db.prepare(
  `SELECT id, customer_id FROM rides WHERE driver_id = ? AND status IN ('accepted','arrived','in_progress') ORDER BY id DESC LIMIT 1`,
);

/** Persist a driver's position and push it to the customer of their active ride. */
export function updateDriverLocation(driverId, lat, lng, heading) {
  update.run(lat, lng, heading, driverId);
  const ride = activeRide.get(driverId);
  if (ride) notify(ride.customer_id, { ride_id: ride.id, driver_id: driverId, lat, lng, heading });
}
