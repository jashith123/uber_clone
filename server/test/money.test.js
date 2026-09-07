/** Wallet ledger, promo codes and surge pricing. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { credit, debit, getWallet, listTransactions, settleRide } = await import('../src/services/payments.js');
const { quotePromo, redeemPromo } = await import('../src/services/promos.js');
const { computeFare } = await import('../src/services/fare.js');
const { surgeAt } = await import('../src/services/surge.js');

let rider;
let drv;

before(() => {
  const mk = (role, email) =>
    Number(db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run(role, email, email, hashPassword('x')).lastInsertRowid);
  rider = { id: mk('customer', 'r@t.com'), role: 'customer' };
  drv = { id: mk('driver', 'v@t.com'), role: 'driver' };
  db.prepare(`INSERT INTO driver_profiles (user_id, vehicle_type) VALUES (?, 'economy')`).run(drv.id);
});

test('wallet credits and debits keep a running balance', () => {
  credit(rider.id, 500, 'topup');
  assert.equal(getWallet(rider.id).balance, 500);
  debit(rider.id, 120.5, 'ride_fare');
  assert.equal(getWallet(rider.id).balance, 379.5);
  const tx = listTransactions(rider.id);
  assert.equal(tx[0].amount, -120.5);
  assert.equal(tx[0].balance_after, 379.5);
});

test('a wallet ride cannot overdraw the rider', () => {
  assert.throws(() => debit(rider.id, 99999, 'ride_fare', { allowNegative: false }), /Not enough balance/);
});

test('settling a wallet ride pays the driver the fare minus commission', () => {
  const before = getWallet(rider.id).balance;
  const ride = { id: 1, customer_id: rider.id, driver_id: drv.id, fare_final: 200, fare_estimate: 200, payment_method: 'wallet' };
  db.prepare(`INSERT INTO rides (id, customer_id, driver_id, vehicle_type, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      waypoints, route_geometry, distance_km, duration_min, fare_estimate, fare_breakdown, status)
      VALUES (1, ?, ?, 'economy', 0,0,0,0, '[]', '[]', 5, 10, 200, '{}', 'completed')`).run(rider.id, drv.id);

  const { commission, driverShare } = settleRide(ride);
  assert.equal(commission, 30); // 15% of 200
  assert.equal(driverShare, 170);
  assert.equal(getWallet(rider.id).balance, Math.round((before - 200) * 100) / 100);
  assert.equal(getWallet(drv.id).balance, 170);
});

test('a cash ride takes only the commission from the driver', () => {
  const driverBefore = getWallet(drv.id).balance;
  const riderBefore = getWallet(rider.id).balance;
  db.prepare(`INSERT INTO rides (id, customer_id, driver_id, vehicle_type, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      waypoints, route_geometry, distance_km, duration_min, fare_estimate, fare_breakdown, status, payment_method)
      VALUES (2, ?, ?, 'economy', 0,0,0,0, '[]', '[]', 5, 10, 100, '{}', 'completed', 'cash')`).run(rider.id, drv.id);
  settleRide({ id: 2, customer_id: rider.id, driver_id: drv.id, fare_final: 100, fare_estimate: 100, payment_method: 'cash' });
  assert.equal(getWallet(rider.id).balance, riderBefore, 'rider paid in cash, wallet untouched');
  assert.equal(getWallet(drv.id).balance, Math.round((driverBefore - 15) * 100) / 100);
});

test('promo: percent code is capped and can only be used once per rider', () => {
  const q = quotePromo(rider, 'WELCOME50', 400);
  assert.equal(q.ok, true);
  assert.equal(q.discount, 100); // 50% of 400 = 200, capped at 100
  redeemPromo(rider, q.code, null, q.discount);
  assert.equal(quotePromo(rider, 'WELCOME50', 400).ok, false);
});

test('promo: flat code respects its minimum fare', () => {
  assert.equal(quotePromo(rider, 'FLAT30', 50).ok, false); // min fare is 100
  const q = quotePromo(rider, 'FLAT30', 250);
  assert.equal(q.ok, true);
  assert.equal(q.discount, 30);
});

test('promo: an unknown code is rejected, not silently ignored', () => {
  const q = quotePromo(rider, 'NOPE', 300);
  assert.equal(q.ok, false);
  assert.match(q.reason, /does not exist/);
});

test('fare: surge multiplies distance and time but never the base or booking fee', () => {
  const p = db.prepare('SELECT * FROM pricing WHERE vehicle_type = ?').get('economy');
  const plain = computeFare(p, 10, 20).breakdown;
  const surged = computeFare(p, 10, 20, { surge: 2 }).breakdown;
  assert.equal(surged.distance_charge, plain.distance_charge * 2);
  assert.equal(surged.time_charge, plain.time_charge * 2);
  assert.equal(surged.base_fare, plain.base_fare);
  assert.equal(surged.booking_fee, plain.booking_fee);
});

test('fare: the discount comes off after the minimum-fare floor', () => {
  const p = db.prepare('SELECT * FROM pricing WHERE vehicle_type = ?').get('economy');
  const f = computeFare(p, 0.3, 1, { discount: 20 });
  assert.equal(f.breakdown.min_fare_applied, true);
  assert.equal(f.breakdown.subtotal, 50); // floored at the minimum
  assert.equal(f.total, 30); // then the promo comes off
});

test('surge: an active zone raises the multiplier for pickups inside it', () => {
  assert.equal(surgeAt({ lat: 28.7, lng: 77.5 }, 'economy').multiplier, 1);
  db.prepare(`INSERT INTO surge_zones (name, lat, lng, radius_km, multiplier, active) VALUES ('Test', 28.7, 77.5, 3, 1.8, 1)`).run();
  const s = surgeAt({ lat: 28.7, lng: 77.5 }, 'economy');
  assert.equal(s.multiplier, 1.8);
  assert.match(s.reason, /Test/);
  // Outside the radius it is back to normal.
  assert.equal(surgeAt({ lat: 29.5, lng: 78.5 }, 'economy').multiplier, 1);
});
