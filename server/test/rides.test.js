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
const payments = await import('../src/services/payments.js');

let customer;
let driver;
let driver2;

function mkDriver(email, lat = 28.6, lng = 77.2) {
  const id = Number(
    db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('driver', email, email, hashPassword('x')).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO driver_profiles (user_id, vehicle_type, is_online, lat, lng, approval_status, location_at) VALUES (?,?,1,?,?,'approved', datetime('now'))`,
  ).run(id, 'economy', lat, lng);
  payments.credit(id, 500, 'topup', { note: 'test float so cash rides can be accepted' });
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

  r = rides.advanceRide(driver, id, 'completed', { collected_via: 'driver' });
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
  assert.throws(() => rides.advanceRide(driver, id, 'completed', { collected_via: 'driver' }), /Cannot move/);
  rides.advanceRide(driver, id, 'in_progress', { pin: '1234' });
  rides.advanceRide(driver, id, 'completed', { collected_via: 'driver' });
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

// ---------------------------------------------------------------- wallet ----


test('a wallet booking is refused when the wallet cannot cover the fare', () => {
  const poor = Number(
    db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('customer', 'P', 'poor@t.com', hashPassword('x')).lastInsertRowid,
  );
  assert.throws(() => rides.assertWalletCovers(poor, 170), /wallet has ₹0\.00 but this ride costs ₹170\.00/);
  payments.credit(poor, 169.99, 'topup', { note: 'test' });
  assert.throws(() => rides.assertWalletCovers(poor, 170), /Add money/);
  payments.credit(poor, 0.01, 'topup', { note: 'test' });
  assert.doesNotThrow(() => rides.assertWalletCovers(poor, 170));
});

test('a wallet ride whose balance ran out by the end is settled as cash, so the driver is still paid', () => {
  const id = insertRequested();
  db.prepare(`UPDATE rides SET payment_method = 'wallet' WHERE id = ?`).run(id);
  // The rider's wallet is empty by the time the trip ends.
  const w = payments.getWallet(customer.id);
  if (w.balance !== 0) payments.credit(customer.id, -w.balance, 'adjustment', { note: 'zero for test' });
  const driverBefore = payments.getWallet(driver.id).balance;

  rides.acceptRide(driver, id);
  rides.advanceRide(driver, id, 'arrived');
  rides.advanceRide(driver, id, 'in_progress', { pin: '1234' });
  const r = rides.advanceRide(driver, id, 'completed', { collected_via: 'driver' });

  assert.equal(r.status, 'completed');
  assert.equal(r.payment_method, 'cash', 'falls back to cash');
  assert.equal(r.payment_status, 'paid');
  // Cash settlement: the driver keeps the fare and owes only the commission.
  const driverAfter = payments.getWallet(driver.id).balance;
  assert.ok(driverAfter < driverBefore, 'commission was debited from the driver');
  assert.equal(payments.getWallet(customer.id).balance, 0, 'the empty wallet was not driven negative');
  const trail = db.prepare(`SELECT type FROM ride_events WHERE ride_id = ? ORDER BY id`).all(id).map((e) => e.type);
  assert.ok(trail.includes('payment_fallback_cash'));
  assert.ok(!trail.includes('settle_failed'));
});

// ------------------------------------------------- arrival, class, ratings ----

test('"I\'ve arrived" is refused more than 1 km from the pickup and accepted within it', () => {
  const far = mkDriver('far@t.com', 28.7, 77.3); // ~15 km from the 28.6,77.2 pickup
  const id = insertRequested();
  db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, far.id);
  rides.acceptRide(far, id);
  assert.throws(() => rides.advanceRide(far, id, 'arrived'), /km from the pickup/);
  // Starting straight from "accepted" is the same claim and is refused too.
  assert.throws(() => rides.advanceRide(far, id, 'in_progress', { pin: '1234' }), /km from the pickup/);
  // The car drives to 600 m from the pickup: close enough.
  db.prepare(`UPDATE driver_profiles SET lat = 28.6054, lng = 77.2, location_at = datetime('now') WHERE user_id = ?`).run(far.id);
  assert.equal(rides.advanceRide(far, id, 'arrived').status, 'arrived');
});

test('"I\'ve arrived" is refused when the driver has no recent location', () => {
  const ghost = mkDriver('ghost@t.com', 28.6, 77.2);
  db.prepare(`UPDATE driver_profiles SET location_at = datetime('now', '-30 minutes') WHERE user_id = ?`).run(ghost.id);
  const id = insertRequested();
  db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, ghost.id);
  rides.acceptRide(ghost, id);
  assert.throws(() => rides.advanceRide(ghost, id, 'arrived'), /cannot see your location/);
});

test('a driver cannot accept a ride priced for another vehicle class', () => {
  const moto = mkDriver('moto@t.com');
  db.prepare(`UPDATE driver_profiles SET vehicle_type = 'bike' WHERE user_id = ?`).run(moto.id);
  moto.driver.vehicle_type = 'bike';
  const id = insertRequested(); // an economy ("Go") ride
  db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, moto.id);
  assert.throws(() => rides.acceptRide(moto, id), /This is a Go ride.*Moto class/);
});

test('ratings are the plain average of every rating received, for drivers and riders', () => {
  const d = mkDriver('avg@t.com');
  assert.deepEqual(rides.ratingFor(d.id, 'driver'), { rating: null, rating_count: 0 });
  for (const stars of [5, 3, 4]) {
    const id = insertRequested();
    db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, d.id);
    rides.acceptRide(d, id);
    rides.advanceRide(d, id, 'arrived');
    rides.advanceRide(d, id, 'in_progress', { pin: '1234' });
    rides.advanceRide(d, id, 'completed', { collected_via: 'driver' });
    rides.rateRide(customer, id, stars);
    rides.rateRide(d, id, 2);
  }
  assert.deepEqual(rides.ratingFor(d.id, 'driver'), { rating: 4, rating_count: 3 });
  const profile = db.prepare('SELECT rating, rating_count FROM driver_profiles WHERE user_id = ?').get(d.id);
  assert.equal(profile.rating, 4);
  assert.equal(profile.rating_count, 3);
  const c = rides.ratingFor(customer.id, 'customer');
  assert.equal(c.rating_count >= 3, true);
  assert.equal(c.rating <= 5 && c.rating >= 1, true);
});

test('a call is logged into the chat as a call entry, text is still text', async () => {
  const chat = await import('../src/services/chat.js');
  const id = insertRequested();
  rides.acceptRide(driver, id);
  const m1 = chat.sendMessage(customer, id, 'hello');
  assert.equal(m1.kind, 'text');
  const m2 = chat.sendMessage(driver, id, 'Voice call · 00:42', 'call');
  assert.equal(m2.kind, 'call');
  assert.throws(() => chat.sendMessage(driver, id, 'x', 'sticker'), /Unknown message kind/);
  assert.deepEqual(chat.listMessages(customer, id).map((m) => m.kind), ['text', 'call']);
});
// ------------------------------------------------- settlement and the owner ----

const offerTo = (rideId, driverId) =>
  db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(rideId, driverId);

test('a cash ride ends in two steps: reach the destination, then confirm where the fare was collected', () => {
  const d = mkDriver('settle1@t.com');
  const id = insertRequested();
  offerTo(id, d.id);
  rides.acceptRide(d, id);
  rides.advanceRide(d, id, 'arrived');
  rides.advanceRide(d, id, 'in_progress', { pin: '1234' });
  // First tap: the trip is at the destination but not over; both apps show "collect / pay ₹170".
  let r = rides.advanceRide(d, id, 'completed');
  assert.equal(r.status, 'in_progress');
  assert.equal(r.payment_status, 'collecting');
  assert.equal(r.fare_final, 170);
  assert.ok(r.dropped_at);
  assert.throws(() => rides.advanceRide(d, id, 'completed', { collected_via: 'bank' }), /company_qr or driver/);
  // Second tap: collected on the company QR -> the company holds the fare and owes the driver 90%.
  const companyBefore = payments.companyBalance();
  const driverBefore = payments.getWallet(d.id).balance;
  r = rides.advanceRide(d, id, 'completed', { collected_via: 'company_qr' });
  assert.equal(r.status, 'completed');
  assert.equal(r.payment_status, 'paid');
  assert.equal(r.collected_via, 'company_qr');
  assert.equal(r.commission, 17);
  assert.equal(r.driver_share, 153);
  assert.equal(payments.getWallet(d.id).balance, Math.round((driverBefore + 153) * 100) / 100);
  assert.equal(payments.companyBalance(), Math.round((companyBefore + 170) * 100) / 100);
});

test('a fare collected by the driver himself costs him the commission, which the company books as income', () => {
  const d = mkDriver('settle2@t.com');
  const id = insertRequested();
  offerTo(id, d.id);
  rides.acceptRide(d, id);
  rides.advanceRide(d, id, 'arrived');
  rides.advanceRide(d, id, 'in_progress', { pin: '1234' });
  rides.advanceRide(d, id, 'completed');
  const companyBefore = payments.companyBalance();
  const driverBefore = payments.getWallet(d.id).balance;
  const r = rides.advanceRide(d, id, 'completed', { collected_via: 'driver' });
  assert.equal(r.collected_via, 'driver');
  assert.equal(payments.getWallet(d.id).balance, Math.round((driverBefore - 17) * 100) / 100);
  assert.equal(payments.companyBalance(), Math.round((companyBefore + 17) * 100) / 100);
  assert.equal(payments.companyTotal('commission') >= 17, true);
});

test('a cash ride is not given to a driver whose wallet cannot cover the commission', () => {
  const broke = mkDriver('broke@t.com');
  const w = payments.getWallet(broke.id);
  if (w.balance) payments.credit(broke.id, -w.balance, 'adjustment', { note: 'zero for test' });
  const id = insertRequested({ offer: false });
  // Dispatch skips him entirely...
  dispatch.startDispatch(id, 1);
  assert.equal(dispatch.hasOffer(id, broke.id), false, 'not offered');
  // ...and a direct accept is refused with the amount he needs.
  offerTo(id, broke.id);
  assert.throws(() => rides.acceptRide(broke, id), /need at least ₹17\.00 in your wallet/);
  payments.credit(broke.id, 17, 'topup', { note: 'test' });
  assert.equal(rides.acceptRide(broke, id).status, 'accepted');
});

test('the owner pays a driver out of what the company holds', () => {
  const d = mkDriver('paid@t.com'); // starts with the 500 test float
  const before = payments.getWallet(d.id).balance;
  payments.requestPayout({ id: d.id }, 50);
  assert.equal(db.prepare('SELECT payout_requested FROM driver_profiles WHERE user_id = ?').get(d.id).payout_requested, 50);
  const companyBefore = payments.companyBalance();
  payments.payDriver(d.id, 50, 'test payout');
  assert.equal(payments.getWallet(d.id).balance, Math.round((before - 50) * 100) / 100);
  assert.equal(payments.companyBalance(), Math.round((companyBefore - 50) * 100) / 100);
  assert.equal(db.prepare('SELECT payout_requested FROM driver_profiles WHERE user_id = ?').get(d.id).payout_requested, 0);
  assert.throws(() => payments.payDriver(d.id, 1e9), /only holds/);
});
