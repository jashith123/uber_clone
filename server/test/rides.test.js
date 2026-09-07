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
const dispatch = await import('../src/services/dispatch.js');

let customer;
let driver;
let driver2;

function mkDriver(email, lat = 28.6, lng = 77.2) {
  const id = Number(
    db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('driver', email, email, hashPassword('x')).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO driver_profiles (user_id, vehicle_type, is_online, lat, lng, approval_status) VALUES (?,?,1,?,?,'approved')`,
  ).run(id, 'economy', lat, lng);
  return { id, role: 'driver', driver: { vehicle_type: 'economy', is_online: 1, lat, lng, approval_status: 'approved' } };
}

before(() => {
  const cid = Number(
    db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('customer', 'C', 'c@t.com', hashPassword('x')).lastInsertRowid,
  );
  customer = { id: cid, role: 'customer', name: 'C' };
  driver = mkDriver('d@t.com');
  driver2 = mkDriver('d2@t.com', 28.601, 77.201);
});

/** Insert a requested ride and offer it to everyone, the way dispatch would. */
function insertRequested({ offer = true } = {}) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO rides (customer_id, vehicle_type, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, waypoints, route_geometry,
          distance_km, duration_min, fare_estimate, fare_breakdown, pin, share_token)
         VALUES (?, 'economy', 28.6, 77.2, 28.7, 77.3, '[{"lat":28.6,"lng":77.2},{"lat":28.7,"lng":77.3}]', '[[28.6,77.2],[28.7,77.3]]', 10, 15, 170, '{}', '1234', 'tok' || abs(random()))`,
      )
      .run(customer.id).lastInsertRowid,
  );
  if (offer) {
    for (const d of [driver, driver2]) {
      db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, d.id);
    }
  }
  return id;
}

test('a driver only sees rides dispatch has offered them', () => {
  const id = insertRequested();
  const list = rides.availableRides(driver);
  assert.ok(list.some((r) => r.id === id));
  assert.equal(typeof list[0].offer_expires_at, 'string');

  const unoffered = insertRequested({ offer: false });
  assert.ok(!rides.availableRides(driver).some((r) => r.id === unoffered));

  rides.cancelRide(customer, id, 'test');
  rides.cancelRide(customer, unoffered, 'test');
});

test('a ride that was never offered cannot be accepted', () => {
  const id = insertRequested({ offer: false });
  assert.throws(() => rides.acceptRide(driver, id), /no longer offered/);
  rides.cancelRide(customer, id);
});

test('happy path: requested -> accepted -> arrived -> in_progress -> completed', () => {
  const id = insertRequested();
  let r = rides.acceptRide(driver, id);
  assert.equal(r.status, 'accepted');
  assert.equal(r.driver.id, driver.id);

  r = rides.advanceRide(driver, id, 'arrived');
  assert.equal(r.status, 'arrived');

  // The PIN is required, and it is the rider's PIN.
  assert.throws(() => rides.advanceRide(driver, id, 'in_progress', { pin: '0000' }), /Wrong PIN/);
  r = rides.advanceRide(driver, id, 'in_progress', { pin: '1234' });
  assert.equal(r.status, 'in_progress');

  r = rides.advanceRide(driver, id, 'completed');
  assert.equal(r.status, 'completed');
  assert.equal(r.fare_final, 170);

  r = rides.rateRide(customer, id, 4);
  assert.equal(r.driver_rating, 4);
  assert.throws(() => rides.rateRide(customer, id, 5), /Already rated/);
});

test('the PIN is shown to the rider and hidden from the driver', () => {
  const id = insertRequested();
  rides.acceptRide(driver, id);
  assert.equal(rides.getRide(id, customer.id).pin, '1234');
  assert.equal(rides.getRide(id, driver.id).pin, null);
  assert.equal(rides.getRide(id, driver.id).pin_required, true);
  rides.cancelRide(driver, id, 'cleanup');
  rides.cancelRide(customer, id, 'cleanup');
});

test('a ride can only be accepted once', () => {
  const id = insertRequested();
  rides.acceptRide(driver, id);
  assert.throws(() => rides.acceptRide(driver2, id), /already taken|no longer offered/);
  rides.cancelRide(driver, id, 'cleanup');
  rides.cancelRide(customer, id, 'cleanup');
});

test('driver with an active ride cannot accept another', () => {
  const a = insertRequested();
  rides.acceptRide(driver, a);
  const b = insertRequested();
  assert.throws(() => rides.acceptRide(driver, b), /Finish your current ride/);
  rides.cancelRide(driver, a);
  rides.cancelRide(customer, a);
  rides.cancelRide(customer, b);
});

test('declining an offer retires it without touching the ride', () => {
  const id = insertRequested();
  const out = rides.declineRide(driver, id);
  assert.equal(out.ok, true);
  assert.ok(!rides.availableRides(driver).some((r) => r.id === id));
  assert.throws(() => rides.acceptRide(driver, id), /no longer offered/);
  assert.equal(rides.getRide(id).status, 'requested');
  rides.cancelRide(customer, id);
});

test('cannot complete a ride that has not started, cannot cancel a completed ride', () => {
  const id = insertRequested();
  rides.acceptRide(driver, id);
  assert.throws(() => rides.advanceRide(driver, id, 'completed'), /Cannot move/);
  rides.advanceRide(driver, id, 'in_progress', { pin: '1234' });
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
  assert.equal(rides.getRide(id).cancel_policy.customer_fee, 30);
  r = rides.cancelRide(customer, id);
  assert.equal(r.cancel_fee, 30);
});

test('a driver cancelling after accepting is penalised and the rider is re-queued', () => {
  const id = insertRequested();
  rides.acceptRide(driver, id);
  const r = rides.cancelRide(driver, id, 'car trouble');
  // The rider goes back to searching rather than being stranded.
  assert.equal(r.status, 'requested');
  assert.equal(r.driver_id, null);
  const penalty = db.prepare(`SELECT COALESCE(SUM(-amount),0) AS n FROM wallet_transactions WHERE user_id = ? AND type = 'cancel_penalty'`).get(driver.id).n;
  assert.ok(penalty >= rides.DRIVER_CANCEL_PENALTY, 'driver was charged the penalty');
  rides.cancelRide(customer, id, 'cleanup');
});

test('dispatch offers to the nearest free driver and stops when the ride is taken', () => {
  const id = insertRequested({ offer: false });
  dispatch.startDispatch(id);
  const offered = db.prepare(`SELECT driver_id FROM ride_offers WHERE ride_id = ? AND status = 'offered'`).all(id);
  assert.ok(offered.length >= 1, 'at least one driver was offered the ride');

  rides.acceptRide(driver, id);
  const open = db.prepare(`SELECT COUNT(*) AS n FROM ride_offers WHERE ride_id = ? AND status = 'offered'`).get(id).n;
  assert.equal(open, 0, 'every other offer was closed');

  rides.cancelRide(driver, id, 'cleanup');
  rides.cancelRide(customer, id, 'cleanup');
});
