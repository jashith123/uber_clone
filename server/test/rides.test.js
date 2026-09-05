/**
 * Ride state-machine tests against an in-memory database.
 * Rides are inserted directly (no OSRM call) so the suite runs offline.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const rides = await import('../src/services/rides.js');

let customer;
let driver;

before(() => {
  const u = db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)');
  const cid = Number(u.run('customer', 'C', 'c@t.com', hashPassword('x')).lastInsertRowid);
  const did = Number(u.run('driver', 'D', 'd@t.com', hashPassword('x')).lastInsertRowid);
  db.prepare('INSERT INTO driver_profiles (user_id, vehicle_type, is_online, lat, lng) VALUES (?,?,1,28.6,77.2)').run(did, 'economy');
  customer = { id: cid, role: 'customer' };
  driver = { id: did, role: 'driver', driver: { vehicle_type: 'economy', is_online: 1, lat: 28.6, lng: 77.2 } };
});

function insertRequested() {
  const r = db
    .prepare(
      `INSERT INTO rides (customer_id, vehicle_type, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, waypoints, route_geometry,
        distance_km, duration_min, fare_estimate, fare_breakdown)
       VALUES (?, 'economy', 28.6, 77.2, 28.7, 77.3, '[{"lat":28.6,"lng":77.2},{"lat":28.7,"lng":77.3}]', '[[28.6,77.2],[28.7,77.3]]', 10, 15, 170, '{}')`,
    )
    .run(customer.id);
  return Number(r.lastInsertRowid);
}

test('driver sees requested rides of their class, nearest first', () => {
  const id = insertRequested();
  const list = rides.availableRides(driver);
  assert.ok(list.some((r) => r.id === id));
  assert.ok(typeof list[0].pickup_distance_km === 'number');
  rides.cancelRide(customer, id, 'test');
});

test('happy path: requested -> accepted -> arrived -> in_progress -> completed', () => {
  const id = insertRequested();
  let r = rides.acceptRide(driver, id);
  assert.equal(r.status, 'accepted');
  assert.equal(r.driver.id, driver.id);
  r = rides.advanceRide(driver, id, 'arrived');
  assert.equal(r.status, 'arrived');
  r = rides.advanceRide(driver, id, 'in_progress');
  assert.equal(r.status, 'in_progress');
  r = rides.advanceRide(driver, id, 'completed');
  assert.equal(r.status, 'completed');
  assert.equal(r.fare_final, 170);
  r = rides.rateRide(customer, id, 4);
  assert.equal(r.driver_rating, 4);
  assert.throws(() => rides.rateRide(customer, id, 5), /Already rated/);
});

test('a ride can only be accepted once', () => {
  const id = insertRequested();
  rides.acceptRide(driver, id);
  const other = { id: driver.id + 100, role: 'driver', driver: { vehicle_type: 'economy', is_online: 1 } };
  assert.throws(() => rides.acceptRide(other, id), /already taken/);
  rides.cancelRide(driver, id, 'cleanup');
});

test('driver with an active ride cannot accept another', () => {
  const a = insertRequested();
  rides.acceptRide(driver, a);
  const b = insertRequested();
  assert.throws(() => rides.acceptRide(driver, b), /Finish your current ride/);
  rides.cancelRide(driver, a);
  rides.cancelRide(customer, b);
});

test('cannot complete a ride that has not started, cannot cancel a completed ride', () => {
  const id = insertRequested();
  rides.acceptRide(driver, id);
  assert.throws(() => rides.advanceRide(driver, id, 'completed'), /Cannot move/);
  rides.advanceRide(driver, id, 'in_progress');
  rides.advanceRide(driver, id, 'completed');
  assert.throws(() => rides.cancelRide(customer, id), /Cannot cancel/);
});

test('strangers cannot touch a ride', () => {
  const id = insertRequested();
  const stranger = { id: 9999, role: 'customer' };
  assert.throws(() => rides.cancelRide(stranger, id), /Not your ride/);
  rides.cancelRide(customer, id);
});

test('cancellation policy: free in grace, fee after grace or arrival, penalty for driver', () => {
  // free: customer cancels while requested
  let id = insertRequested();
  let r = rides.cancelRide(customer, id, 'changed mind');
  assert.equal(r.cancel_fee, 0);
  assert.equal(r.driver_penalty, 0);

  // free: customer cancels right after accept (inside grace)
  id = insertRequested();
  rides.acceptRide(driver, id);
  r = rides.cancelRide(customer, id);
  assert.equal(r.cancel_fee, 0);

  // fee: driver has arrived
  id = insertRequested();
  rides.acceptRide(driver, id);
  rides.advanceRide(driver, id, 'arrived');
  r = rides.cancelRide(customer, id);
  assert.equal(r.cancel_fee, 30); // economy cancel_fee
  assert.equal(r.driver_penalty, 0);

  // fee: accepted more than the grace period ago
  id = insertRequested();
  rides.acceptRide(driver, id);
  db.prepare(`UPDATE rides SET accepted_at = datetime('now', '-10 minutes') WHERE id = ?`).run(id);
  const quote = rides.getRide(id).cancel_policy;
  assert.equal(quote.customer_fee, 30);
  r = rides.cancelRide(customer, id);
  assert.equal(r.cancel_fee, 30);

  // penalty: driver cancels after accepting
  id = insertRequested();
  rides.acceptRide(driver, id);
  r = rides.cancelRide(driver, id, 'car trouble');
  assert.equal(r.driver_penalty, rides.DRIVER_CANCEL_PENALTY);
  assert.equal(r.cancel_fee, 0);
});
