/** Seeds demo accounts so the app can be tried immediately. Safe to re-run. */
import { db } from './db.js';
import { hashPassword } from './auth.js';

const demo = [
  { role: 'customer', name: 'Asha Customer', email: 'customer@demo.com', phone: '+91 90000 00001', password: 'password' },
  { role: 'customer', name: 'Rahul Rider', email: 'rider2@demo.com', phone: '+91 90000 00002', password: 'password' },
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
];

const insertUser = db.prepare('INSERT INTO users (role, name, email, phone, password_hash) VALUES (?,?,?,?,?)');
const insertDriver = db.prepare(
  `INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_make, vehicle_model, vehicle_color, plate, lat, lng, is_online)
   VALUES (?,?,?,?,?,?,?,?,1)`,
);

for (const d of demo) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(d.email);
  if (existing) {
    console.log(`skip  ${d.email} (exists)`);
    continue;
  }
  const r = insertUser.run(d.role, d.name, d.email, d.phone, hashPassword(d.password));
  const id = Number(r.lastInsertRowid);
  if (d.role === 'driver') {
    insertDriver.run(id, d.vehicle.vehicle_type, d.vehicle.make, d.vehicle.model, d.vehicle.color, d.vehicle.plate, d.location.lat, d.location.lng);
  }
  console.log(`added ${d.role.padEnd(8)} ${d.email} / ${d.password}`);
}
console.log('Seed complete.');
