/**
 * Ride state-machine tests against an in-memory database.
 * Rides are inserted directly (no OSRM call) so the suite runs offline.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.DRIVER_FREE_RIDES = '0'; // these tests check the normal commission; incentives.test.js covers the free rides

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

// --------------------------------------------- rider wallet, fines, reset ----

function zeroWallet(userId) {
  const w = payments.getWallet(userId);
  if (w.balance !== 0) payments.credit(userId, -w.balance, 'adjustment', { note: 'zero for test' });
}

test('the rider wallet pays what it can and the rest is collected at the destination', () => {
  const d = mkDriver('wallet1@t.com');
  zeroWallet(customer.id);
  payments.credit(customer.id, 50, 'topup', { note: 'test' }); // ₹50 against a ₹170 fare
  const id = insertRequested();
  db.prepare(`UPDATE rides SET payment_method = 'wallet' WHERE id = ?`).run(id);
  offerTo(id, d.id);
  rides.acceptRide(d, id);
  rides.advanceRide(d, id, 'arrived');
  rides.advanceRide(d, id, 'in_progress', { pin: '1234' });
  let r = rides.advanceRide(d, id, 'completed');
  assert.equal(r.payment_status, 'collecting');
  assert.equal(r.wallet_paid, 50);
  assert.equal(r.total_due, 170);
  const companyBefore = payments.companyBalance();
  const driverBefore = payments.getWallet(d.id).balance;
  r = rides.advanceRide(d, id, 'completed', { collected_via: 'company_qr' });
  assert.equal(r.status, 'completed');
  assert.equal(payments.getWallet(customer.id).balance, 0, 'wallet emptied, never negative');
  assert.equal(payments.companyBalance(), Math.round((companyBefore + 170) * 100) / 100, '50 from the wallet + 120 on the QR');
  assert.equal(payments.getWallet(d.id).balance, Math.round((driverBefore + 153) * 100) / 100, 'driver gets his 90%');
});

test('a wallet that covers the whole fare ends the ride with nothing to collect', () => {
  const d = mkDriver('wallet2@t.com');
  zeroWallet(customer.id);
  payments.credit(customer.id, 500, 'topup', { note: 'test' });
  const id = insertRequested();
  db.prepare(`UPDATE rides SET payment_method = 'wallet' WHERE id = ?`).run(id);
  offerTo(id, d.id);
  rides.acceptRide(d, id);
  rides.advanceRide(d, id, 'arrived');
  rides.advanceRide(d, id, 'in_progress', { pin: '1234' });
  const r = rides.advanceRide(d, id, 'completed');
  assert.equal(r.status, 'completed');
  assert.equal(r.collected_via, 'wallet');
  assert.equal(r.wallet_paid, 170);
  assert.equal(payments.getWallet(customer.id).balance, 330);
});

test('a late-cancellation fee comes out of the wallet, never below zero; the rest rides along to the next trip', () => {
  const d = mkDriver('fee1@t.com');
  zeroWallet(customer.id);
  payments.credit(customer.id, 10, 'topup', { note: 'test' }); // only ₹10 against a ₹30 fee
  const id = insertRequested();
  offerTo(id, d.id);
  rides.acceptRide(d, id);
  rides.advanceRide(d, id, 'arrived'); // after arrival the fee applies
  const driverBefore = payments.getWallet(d.id).balance;
  const owedBefore = db.prepare('SELECT outstanding_fee FROM users WHERE id = ?').get(customer.id).outstanding_fee;
  const r = rides.cancelRide(customer, id, 'test');
  assert.equal(r.cancel_fee, 30);
  assert.equal(payments.getWallet(customer.id).balance, 0, 'wallet drained to zero, not negative');
  const u = db.prepare('SELECT outstanding_fee FROM users WHERE id = ?').get(customer.id);
  assert.equal(Math.round((u.outstanding_fee - owedBefore) * 100) / 100, 20, 'the unpaid ₹20 is carried');
  assert.equal(payments.getWallet(d.id).balance, Math.round((driverBefore + 30) * 100) / 100, 'the driver still gets the whole fee');

  // The next ride carries the ₹20 and collects it with the fare.
  const id2 = insertRequested();
  // insertRequested bypasses createRide, so carry the fee the way createRide does.
  db.prepare('UPDATE rides SET due_carried = 20 WHERE id = ?').run(id2);
  const d2 = mkDriver('fee2@t.com');
  offerTo(id2, d2.id);
  rides.acceptRide(d2, id2);
  rides.advanceRide(d2, id2, 'arrived');
  rides.advanceRide(d2, id2, 'in_progress', { pin: '1234' });
  let r2 = rides.advanceRide(d2, id2, 'completed');
  assert.equal(r2.total_due, 190, '170 fare + 20 carried');
  const companyBefore = payments.companyBalance();
  r2 = rides.advanceRide(d2, id2, 'completed', { collected_via: 'driver' });
  assert.equal(r2.status, 'completed');
  // The driver holds ₹190 in cash; his share is ₹153, so ₹37 leaves his wallet: ₹17 commission + ₹20 carried fee.
  const tx = db.prepare(`SELECT amount FROM wallet_transactions WHERE user_id = ? AND ride_id = ? AND type = 'commission'`).get(d2.id, id2);
  assert.equal(tx.amount, -37);
  assert.equal(payments.companyBalance(), Math.round((companyBefore + 37) * 100) / 100);
  assert.equal(Math.round((db.prepare('SELECT outstanding_fee FROM users WHERE id = ?').get(customer.id).outstanding_fee - owedBefore) * 100) / 100, 0, 'the carried ₹20 is cleared');
});

test('a wallet rider whose wallet covers the fare can be served by a driver with an empty wallet', () => {
  const poorDriver = mkDriver('poor@t.com', 28.9, 77.5); // alone near this pickup
  zeroWallet(poorDriver.id);
  zeroWallet(customer.id);
  payments.credit(customer.id, 500, 'topup', { note: 'test' });
  const id = insertRequested({ offer: false });
  db.prepare(`UPDATE rides SET payment_method = 'wallet', pickup_lat = 28.9, pickup_lng = 77.5 WHERE id = ?`).run(id);
  assert.equal(rides.mayCollectCash(db.prepare('SELECT * FROM rides WHERE id = ?').get(id)), false);
  dispatch.startDispatch(id, 1);
  assert.equal(dispatch.hasOffer(id, poorDriver.id), true, 'offered: no cash can change hands');
  assert.equal(rides.acceptRide(poorDriver, id).status, 'accepted');
});

test('the reset wipes rides and transactions but keeps accounts', async () => {
  const { resetDemoData } = await import('../src/services/reset.js');
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM rides').get().n > 0);
  resetDemoData();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rides').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM company_ledger').get().n, 0);
  assert.equal(payments.getWallet(customer.id).balance, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0, 'accounts kept');
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM pricing').get().n >= 5, 'prices kept');
});
