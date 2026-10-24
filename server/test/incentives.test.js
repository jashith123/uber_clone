/**
 * Trust-building offers: ₹50 off a rider's first ride (paid by the company,
 * never more than half the fare) and commission-free first rides for drivers.
 * Runs with its own settings so the numbers are small and exact.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.DRIVER_FREE_RIDES = '2';
process.env.FIRST_RIDE_OFF = '50';

const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const rides = await import('../src/services/rides.js');
const payments = await import('../src/services/payments.js');
const promos = await import('../src/services/promos.js');

let customer;
let driver;

function mkDriver(email) {
  const id = Number(db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('driver', email, email, hashPassword('x')).lastInsertRowid);
  db.prepare(`INSERT INTO driver_profiles (user_id, vehicle_type, is_online, lat, lng, approval_status, location_at) VALUES (?,?,1,28.6,77.2,'approved', datetime('now'))`).run(id, 'economy');
  payments.credit(id, 500, 'topup', { note: 'float' });
  return { id, role: 'driver', driver: { vehicle_type: 'economy', is_online: 1, lat: 28.6, lng: 77.2, approval_status: 'approved' } };
}

/** A requested ride with the given fare, optionally carrying a first-ride discount. */
function insertRide(fare, discount = 0, promo = null) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO rides (customer_id, vehicle_type, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, waypoints, route_geometry,
          distance_km, duration_min, fare_estimate, fare_breakdown, pin, share_token, discount, promo_code)
         VALUES (?, 'economy', 28.6, 77.2, 28.7, 77.3, '[{"lat":28.6,"lng":77.2},{"lat":28.7,"lng":77.3}]', '[[28.6,77.2],[28.7,77.3]]', 10, 15, ?, '{}', '1234', 'tok' || abs(random()), ?, ?)`,
      )
      .run(customer.id, fare, discount, promo).lastInsertRowid,
  );
  db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, driver.id);
  return id;
}

function runToEnd(id, via = 'company_qr') {
  rides.acceptRide(driver, id);
  rides.advanceRide(driver, id, 'arrived');
  rides.advanceRide(driver, id, 'in_progress', { pin: '1234' });
  rides.advanceRide(driver, id, 'completed');
  return rides.advanceRide(driver, id, 'completed', { collected_via: via });
}

before(() => {
  const cid = Number(db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('customer', 'C', 'c@t.com', hashPassword('x')).lastInsertRowid);
  customer = { id: cid, role: 'customer', name: 'C' };
  driver = mkDriver('d@t.com');
});

test('the welcome offer applies by itself on a first ride, never more than half the fare, and only once', () => {
  assert.equal(promos.autoPromoFor(customer), 'FIRSTRIDE');
  assert.deepEqual(promos.quotePromo(customer, 'FIRSTRIDE', 300).discount, 50, '₹50 off a ₹300 ride');
  assert.deepEqual(promos.quotePromo(customer, 'FIRSTRIDE', 40).discount, 20, 'capped at half of a ₹40 ride');
  // After one completed ride the offer is gone.
  runToEnd(insertRide(250, 50, 'FIRSTRIDE'));
  assert.equal(promos.autoPromoFor(customer), null);
  assert.match(promos.quotePromo(customer, 'FIRSTRIDE', 300).reason, /only for your first ride/);
});

test('the company pays for the welcome offer: the driver is paid on the full fare', () => {
  // The ride above: rider paid ₹250 (300 − 50), the driver's first ride is commission-free.
  const r = db.prepare('SELECT * FROM rides ORDER BY id DESC LIMIT 1').get();
  assert.equal(r.fare_final, 250);
  assert.equal(r.commission, 0);
  assert.equal(r.commission_waived, 30, '10% of the ₹300 gross, waived');
  assert.equal(r.driver_share, 300, 'the whole gross fare');
});

test('drivers keep 100% of their first rides, then the commission starts', () => {
  // Ride 2 (second paid ride): still free.
  let r = runToEnd(insertRide(100));
  assert.equal(r.commission, 0);
  assert.equal(r.driver_share, 100);
  // Ride 3: the commission starts.
  r = runToEnd(insertRide(100));
  assert.equal(r.commission, 10);
  assert.equal(r.driver_share, 90);
  assert.equal(rides.driverHasFreeRides(driver.id), false);
});

test('a driver on free rides needs no commission float for a cash ride', () => {
  const fresh = mkDriver('fresh@t.com');
  const w = payments.getWallet(fresh.id);
  payments.credit(fresh.id, -w.balance, 'adjustment', { note: 'zero' });
  const id = insertRide(170);
  db.prepare(`INSERT INTO ride_offers (ride_id, driver_id, wave, distance_km, expires_at) VALUES (?,?,1,1, datetime('now','+60 seconds'))`).run(id, fresh.id);
  assert.equal(rides.acceptRide(fresh, id).status, 'accepted', 'no float needed while rides are commission-free');
});

test('a cancelled first ride gives the welcome offer back', () => {
  const c2 = Number(db.prepare('INSERT INTO users (role,name,email,password_hash) VALUES (?,?,?,?)').run('customer', 'C2', 'c2@t.com', hashPassword('x')).lastInsertRowid);
  const rider2 = { id: c2, role: 'customer', name: 'C2' };
  const id = Number(db.prepare("INSERT INTO rides (customer_id, vehicle_type, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, waypoints, route_geometry, distance_km, duration_min, fare_estimate, fare_breakdown, pin, share_token, discount, promo_code) VALUES (?, 'economy', 28.6, 77.2, 28.7, 77.3, '[]', '[]', 10, 15, 250, '{}', '1234', 'tok-rel', 50, 'FIRSTRIDE')").run(c2).lastInsertRowid);
  promos.redeemPromo(rider2, 'FIRSTRIDE', id, 50); // what createRide does at booking
  assert.match(promos.quotePromo(rider2, 'FIRSTRIDE', 300).reason || '', /already used/);
  rides.cancelRide(rider2, id, 'changed plans');
  assert.equal(promos.quotePromo(rider2, 'FIRSTRIDE', 300).ok, true, 'offer is back after the cancellation');
  assert.equal(promos.autoPromoFor(rider2), 'FIRSTRIDE');
});
