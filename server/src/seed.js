/**
 * Seeds the demo accounts so the app can be tried immediately. Safe to re-run.
 *
 * One account per kind of vehicle, named so it is obvious which is which at the
 * login screen, plus two riders, an admin and the owner. Drivers get a starting
 * wallet balance because a cash ride is only offered to a driver whose wallet
 * already covers the commission on it.
 */
import { db } from './db.js';
import { config } from './config.js';
import { hashPassword } from './auth.js';
import { normalizePhone } from './phone.js';
import { credit, getWallet } from './services/payments.js';

const DRIVER_FLOAT = 200; // starting wallet for demo drivers

const demo = [
  { role: 'customer', name: 'Asha Rider', email: 'rider@demo.com', aliases: ['customer@demo.com'], phone: '+91 90000 00001', topup: 2000 },
  { role: 'customer', name: 'Rahul Rider', email: 'rider2@demo.com', phone: '+91 90000 00002', topup: 500 },
  {
    role: 'driver', name: 'Ravi Moto', email: 'moto.driver@demo.com', aliases: ['driver5@demo.com'], phone: '+91 90000 00014',
    vehicle: { vehicle_type: 'bike', make: 'Honda', model: 'Activa', color: 'Red', plate: 'CH 01 JK 7890' },
    location: { lat: 30.7267, lng: 76.7676 }, // Sector 35, Chandigarh
  },
  {
    role: 'driver', name: 'Gurpreet Auto', email: 'auto.driver@demo.com', phone: '+91 90000 00015',
    vehicle: { vehicle_type: 'auto', make: 'Bajaj', model: 'RE', color: 'Green and yellow', plate: 'CH 01 AR 2468' },
    location: { lat: 30.7174, lng: 76.7484 }, // ISBT Sector 43, Chandigarh
  },
  {
    role: 'driver', name: 'Dev Car', email: 'car.driver@demo.com', aliases: ['driver@demo.com'], phone: '+91 90000 00010',
    vehicle: { vehicle_type: 'economy', make: 'Maruti', model: 'Swift Dzire', color: 'White', plate: 'CH 01 AB 1234' },
    location: { lat: 30.741, lng: 76.7822 }, // Sector 17, Chandigarh
  },
  {
    role: 'driver', name: 'Vikram Car', email: 'car2.driver@demo.com', aliases: ['driver4@demo.com'], phone: '+91 90000 00013',
    vehicle: { vehicle_type: 'economy', make: 'Hyundai', model: 'Aura', color: 'Blue', plate: 'PB 65 GH 3456' },
    location: { lat: 30.6425, lng: 76.8173 }, // Zirakpur Chowk
  },
  {
    role: 'driver', name: 'Meera Comfort', email: 'comfort.driver@demo.com', aliases: ['driver2@demo.com'], phone: '+91 90000 00011',
    vehicle: { vehicle_type: 'comfort', make: 'Honda', model: 'City', color: 'Silver', plate: 'PB 65 CD 5678' },
    location: { lat: 30.7119, lng: 76.7196 }, // Phase 3B2, Mohali
  },
  {
    role: 'driver', name: 'Sanjay SUV', email: 'suv.driver@demo.com', aliases: ['driver3@demo.com'], phone: '+91 90000 00012',
    vehicle: { vehicle_type: 'xl', make: 'Toyota', model: 'Innova', color: 'Grey', plate: 'HR 03 EF 9012' },
    location: { lat: 30.6942, lng: 76.8606 }, // Sector 5, Panchkula
  },
  // Admin: also a rider, so the same login can book a ride and open the panel.
  { role: 'customer', name: 'Admin', email: 'admin@demo.com', phone: '+91 90000 00099', admin: true },
  // Owner: the company's books, every account and wallet, driver payouts.
  { role: 'customer', name: 'Owner', email: 'owner@demo.com', phone: '+91 90000 00100', admin: true, owner: true },
];

const insertUser = db.prepare('INSERT INTO users (role, name, email, phone, password_hash, is_admin, is_owner) VALUES (?,?,?,?,?,?,?)');
const insertDriver = db.prepare(
  `INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_make, vehicle_model, vehicle_color, plate, lat, lng, is_online, approval_status, location_at)
   VALUES (?,?,?,?,?,?,?,?,1,'approved', datetime('now'))`,
);
const findByEmail = db.prepare('SELECT id, email, name FROM users WHERE email = ?');

// The password comes from DEMO_PASSWORD / ADMIN_PASSWORD when set, so a public
// server need not run with the well-known default.
const passwordFor = (d) => (d.admin ? config.adminPassword : config.demoPassword);
const shown = (d) => (passwordFor(d) === 'password' ? 'password' : '(from environment)');

for (const d of demo) {
  let existing = findByEmail.get(d.email);
  // Accounts created under an older name (driver@demo.com and friends) are
  // renamed in place so their rides and wallets carry over.
  if (!existing) {
    for (const alias of d.aliases || []) {
      const old = findByEmail.get(alias);
      if (old) {
        db.prepare('UPDATE users SET email = ?, name = ? WHERE id = ?').run(d.email, d.name, old.id);
        console.log(`renamed ${alias} -> ${d.email}`);
        existing = findByEmail.get(d.email);
        break;
      }
    }
  }

  if (existing) {
    if (d.admin) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
    if (d.owner) db.prepare('UPDATE users SET is_owner = 1 WHERE id = ?').run(existing.id);
    getWallet(existing.id);
    if (d.vehicle) {
      // Keep the registered car and plate in step with the account's name.
      db.prepare(
        `UPDATE driver_profiles SET vehicle_type = ?, vehicle_make = ?, vehicle_model = ?, vehicle_color = ?, plate = ? WHERE user_id = ?`,
      ).run(d.vehicle.vehicle_type, d.vehicle.make, d.vehicle.model, d.vehicle.color, d.vehicle.plate, existing.id);
    }
    if (d.location) {
      // A demo driver parked in another city (an older seed) is moved to their
      // tricity spot; one who has driven around nearby is left where they are.
      db.prepare(
        `UPDATE driver_profiles SET lat = ?, lng = ?, location_at = datetime('now')
         WHERE user_id = ? AND (lat IS NULL OR abs(lat - ?) > 0.5 OR abs(lng - ?) > 0.5)`,
      ).run(d.location.lat, d.location.lng, existing.id, d.location.lat, d.location.lng);
    }
    if (d.role === 'driver' && getWallet(existing.id).balance < DRIVER_FLOAT / 2) {
      credit(existing.id, DRIVER_FLOAT - getWallet(existing.id).balance, 'topup', { note: 'Demo starting balance' });
    }
    // A password set in the environment applies to accounts that already exist too.
    if (process.env.DEMO_PASSWORD || (d.admin && process.env.ADMIN_PASSWORD)) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(passwordFor(d)), existing.id);
      console.log(`reset ${d.email} password ${shown(d)}`);
    } else {
      console.log(`skip  ${d.email} (exists)`);
    }
    continue;
  }

  const r = insertUser.run(d.role, d.name, d.email, normalizePhone(d.phone), hashPassword(passwordFor(d)), d.admin ? 1 : 0, d.owner ? 1 : 0);
  const id = Number(r.lastInsertRowid);
  getWallet(id);
  if (d.topup) credit(id, d.topup, 'topup', { note: 'Demo starting balance' });
  if (d.role === 'driver') {
    insertDriver.run(id, d.vehicle.vehicle_type, d.vehicle.make, d.vehicle.model, d.vehicle.color, d.vehicle.plate, d.location.lat, d.location.lng);
    credit(id, DRIVER_FLOAT, 'topup', { note: 'Demo starting balance' });
  }
  console.log(`added ${d.role.padEnd(8)} ${d.email} / ${shown(d)}${d.owner ? '  (OWNER)' : d.admin ? '  (ADMIN)' : ''}`);
}

// A surge zone that is switched off, so it is visible in the admin panel as an example.
const zone = db.prepare('SELECT id FROM surge_zones WHERE name = ?').get('Airport');
if (!zone) {
  db.prepare('INSERT INTO surge_zones (name, lat, lng, radius_km, multiplier, active) VALUES (?,?,?,?,?,0)').run('Airport', 30.6735, 76.7885, 4, 1.5);
  console.log('added surge zone Airport (inactive)');
}

console.log('Seed complete.');
