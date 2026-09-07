/** Seeds demo accounts so the app can be tried immediately. Safe to re-run. */
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { credit, getWallet } from './services/payments.js';

const demo = [
  { role: 'customer', name: 'Asha Customer', email: 'customer@demo.com', phone: '+91 90000 00001', password: 'password', topup: 2000 },
  { role: 'customer', name: 'Rahul Rider', email: 'rider2@demo.com', phone: '+91 90000 00002', password: 'password', topup: 500 },
  {
    role: 'driver', name: 'Dev Driver', email: 'driver@demo.com', phone: '+91 90000 00010', password: 'password',
    vehicle: { vehicle_type: 'economy', make: 'Maruti', model: 'Swift Dzire', color: 'White', plate: 'DL 01 AB 1234' },
    location: { lat: 28.6139, lng: 77.209 },
  },
  {
    role: 'driver', name: 'Meera Motors', email: 'driver2@demo.com', phone: '+91 90000 00011', password: 'password',
    vehicle: { vehicle_type: 'comfort', make: 'Honda', model: 'City', color: 'Silver', plate: 'DL 02 CD 5678' },
    location: { lat: 28.62, lng: 77.22 },
  },
  {
    role: 'driver', name: 'Sanjay SUV', email: 'driver3@demo.com', phone: '+91 90000 00012', password: 'password',
    vehicle: { vehicle_type: 'xl', make: 'Toyota', model: 'Innova', color: 'Grey', plate: 'DL 03 EF 9012' },
    location: { lat: 28.6, lng: 77.2 },
  },
  {
    role: 'driver', name: 'Vikram Go', email: 'driver4@demo.com', phone: '+91 90000 00013', password: 'password',
    vehicle: { vehicle_type: 'economy', make: 'Hyundai', model: 'Aura', color: 'Blue', plate: 'DL 04 GH 3456' },
    location: { lat: 28.6280, lng: 77.2190 },
  },
  // Admin account. Also a rider, so the same login can book a ride and open the panel.
  { role: 'customer', name: 'Admin', email: 'admin@demo.com', phone: '+91 90000 00099', password: 'password', admin: true },
];

const insertUser = db.prepare('INSERT INTO users (role, name, email, phone, password_hash, is_admin) VALUES (?,?,?,?,?,?)');
const insertDriver = db.prepare(
  `INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_make, vehicle_model, vehicle_color, plate, lat, lng, is_online, approval_status)
   VALUES (?,?,?,?,?,?,?,?,1,'approved')`,
);

for (const d of demo) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(d.email);
  if (existing) {
    if (d.admin) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
    getWallet(existing.id);
    console.log(`skip  ${d.email} (exists)`);
    continue;
  }
  const r = insertUser.run(d.role, d.name, d.email, d.phone, hashPassword(d.password), d.admin ? 1 : 0);
  const id = Number(r.lastInsertRowid);
  getWallet(id);
  if (d.topup) credit(id, d.topup, 'topup', { note: 'Demo starting balance' });
  if (d.role === 'driver') {
    insertDriver.run(id, d.vehicle.vehicle_type, d.vehicle.make, d.vehicle.model, d.vehicle.color, d.vehicle.plate, d.location.lat, d.location.lng);
  }
  console.log(`added ${d.role.padEnd(8)} ${d.email} / ${d.password}${d.admin ? '  (ADMIN)' : ''}`);
}

// A surge zone that is switched off, so it is visible in the admin panel as an example.
const zone = db.prepare('SELECT id FROM surge_zones WHERE name = ?').get('Airport');
if (!zone) {
  db.prepare('INSERT INTO surge_zones (name, lat, lng, radius_km, multiplier, active) VALUES (?,?,?,?,?,0)').run('Airport', 28.5562, 77.1, 4, 1.5);
  console.log('added surge zone Airport (inactive)');
}

console.log('Seed complete.');
