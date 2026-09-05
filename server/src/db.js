import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Default tariff. Fare = base + per_km * km + per_min * min + booking_fee, floored at min_fare.
export const DEFAULT_PRICING = [
  { vehicle_type: 'bike',    label: 'Moto',    description: 'Affordable motorbike rides',       seats: 1, base_fare: 15, per_km: 6,  per_min: 0.5, min_fare: 25,  booking_fee: 2,  sort_order: 0 },
  { vehicle_type: 'economy', label: 'Go',      description: 'Affordable everyday rides',         seats: 4, base_fare: 30, per_km: 12, per_min: 1,   min_fare: 50,  booking_fee: 5,  sort_order: 1 },
  { vehicle_type: 'comfort', label: 'Comfort', description: 'Newer cars with extra legroom',     seats: 4, base_fare: 50, per_km: 16, per_min: 1.5, min_fare: 80,  booking_fee: 8,  sort_order: 2 },
  { vehicle_type: 'xl',      label: 'XL',      description: 'SUVs and vans for groups up to 6',  seats: 6, base_fare: 70, per_km: 22, per_min: 2,   min_fare: 120, booking_fee: 10, sort_order: 3 },
];

export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  seedPricing(db);
  return db;
}

function seedPricing(db) {
  const upsert = db.prepare(`
    INSERT INTO pricing (vehicle_type,label,description,seats,base_fare,per_km,per_min,min_fare,booking_fee,currency,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(vehicle_type) DO NOTHING`);
  for (const p of DEFAULT_PRICING) {
    upsert.run(p.vehicle_type, p.label, p.description, p.seats, p.base_fare, p.per_km, p.per_min, p.min_fare, p.booking_fee, 'INR', p.sort_order);
  }
}

export const db = openDatabase();
