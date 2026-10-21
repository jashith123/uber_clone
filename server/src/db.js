import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Default tariff. Fare = base + per_km * km + per_min * min + booking_fee, floored at min_fare.
// cancel_fee is what a customer pays for cancelling late (after the grace period or after arrival).
export const DEFAULT_PRICING = [
  { vehicle_type: 'bike',    label: 'Moto',    description: 'Affordable motorbike rides',       seats: 1, base_fare: 15, per_km: 6,  per_min: 0.5, min_fare: 25,  booking_fee: 2,  cancel_fee: 10, sort_order: 0 },
  { vehicle_type: 'auto',    label: 'Auto',    description: 'Three-wheeler auto rickshaw',       seats: 3, base_fare: 25, per_km: 9,  per_min: 0.75, min_fare: 35, booking_fee: 3,  cancel_fee: 15, sort_order: 1 },
  { vehicle_type: 'economy', label: 'Go',      description: 'Affordable everyday car rides',     seats: 4, base_fare: 30, per_km: 12, per_min: 1,   min_fare: 50,  booking_fee: 5,  cancel_fee: 30, sort_order: 2 },
  { vehicle_type: 'comfort', label: 'Comfort', description: 'Newer cars with extra legroom',     seats: 4, base_fare: 50, per_km: 16, per_min: 1.5, min_fare: 80,  booking_fee: 8,  cancel_fee: 40, sort_order: 3 },
  { vehicle_type: 'xl',      label: 'XL',      description: 'SUVs and vans for groups up to 6',  seats: 6, base_fare: 70, per_km: 22, per_min: 2,   min_fare: 120, booking_fee: 10, cancel_fee: 50, sort_order: 4 },
];

export const DEFAULT_PROMOS = [
  { code: 'WELCOME50', description: '50% off your first ride, up to Rs 100', kind: 'percent', value: 50, max_discount: 100, min_fare: 0, per_user_limit: 1, total_limit: 0 },
  { code: 'FLAT30', description: 'Rs 30 off any ride over Rs 100', kind: 'flat', value: 30, max_discount: 0, min_fare: 100, per_user_limit: 5, total_limit: 0 },
  { code: 'WEEKEND20', description: '20% off, up to Rs 60', kind: 'percent', value: 20, max_discount: 60, min_fare: 50, per_user_limit: 3, total_limit: 0 },
];

export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  migrate(db);
  seedPricing(db);
  seedPromos(db);
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(db) {
  const ensureColumn = (table, column, definition) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  ensureColumn('pricing', 'cancel_fee', 'REAL NOT NULL DEFAULT 0');

  ensureColumn('rides', 'cancel_fee', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('rides', 'driver_penalty', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('rides', 'pin', 'TEXT');                       // 4 digits the rider reads out at pickup
  ensureColumn('rides', 'share_token', 'TEXT');               // public trip-tracking link
  ensureColumn('rides', 'surge_multiplier', 'REAL NOT NULL DEFAULT 1');
  ensureColumn('rides', 'promo_code', 'TEXT');
  ensureColumn('rides', 'discount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('rides', 'payment_status', "TEXT NOT NULL DEFAULT 'pending'"); // pending | paid | failed
  ensureColumn('rides', 'driver_eta_min', 'REAL');            // live minutes to pickup
  ensureColumn('rides', 'dispatch_state', "TEXT NOT NULL DEFAULT 'idle'");    // idle | searching | no_drivers

  ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'is_blocked', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('driver_profiles', 'approval_status', "TEXT NOT NULL DEFAULT 'approved'");
  ensureColumn('driver_profiles', 'approval_note', 'TEXT');
  ensureColumn('driver_profiles', 'approved_at', 'TEXT');
  ensureColumn('driver_profiles', 'acceptance_rate', 'REAL NOT NULL DEFAULT 100');
  ensureColumn('driver_profiles', 'offers_seen', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('driver_profiles', 'offers_taken', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('ride_messages', 'kind', "TEXT NOT NULL DEFAULT 'text'"); // text | call

  // Settlement: how the fare was collected and how it was split.
  ensureColumn('rides', 'collected_via', 'TEXT');            // wallet | card | company_qr | driver
  ensureColumn('rides', 'commission', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('rides', 'driver_share', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('rides', 'dropped_at', 'TEXT');               // reached the destination; fare being collected
  ensureColumn('driver_profiles', 'upi_id', 'TEXT');
  ensureColumn('driver_profiles', 'payout_requested', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('driver_profiles', 'payout_requested_at', 'TEXT');
  ensureColumn('users', 'is_owner', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'outstanding_fee', 'REAL NOT NULL DEFAULT 0'); // rider fines not yet collected; added to the next ride
  ensureColumn('rides', 'due_carried', 'REAL NOT NULL DEFAULT 0');     // outstanding fee folded into this ride
  ensureColumn('rides', 'wallet_paid', 'REAL NOT NULL DEFAULT 0');     // part of the total paid from the rider's wallet
  ensureColumn('rides', 'commission_waived', 'REAL NOT NULL DEFAULT 0'); // commission not taken on a driver's free first rides
  ensureColumn('promo_codes', 'first_ride_only', 'INTEGER NOT NULL DEFAULT 0'); // applied by itself on a rider's first ride

  // The welcome offer: ₹50 off the first ride, applied automatically. It
  // replaces the old WELCOME50 code so a rider cannot stack two first-ride offers.
  db.prepare(
    `INSERT INTO promo_codes (code, description, kind, value, max_discount, min_fare, per_user_limit, total_limit, first_ride_only)
     VALUES ('FIRSTRIDE', 'Welcome offer: Rs 50 off your first ride', 'flat', 50, 0, 0, 1, 0, 1)
     ON CONFLICT(code) DO UPDATE SET first_ride_only = 1`,
  ).run();
  db.prepare(`UPDATE promo_codes SET active = 0 WHERE code = 'WELCOME50'`).run();

  // Ratings are the plain average of every rating received; keep the cached
  // copy on the profile honest for databases rated under the old running sum.
  db.exec(`UPDATE driver_profiles SET
    rating = COALESCE((SELECT AVG(driver_rating) FROM rides WHERE rides.driver_id = driver_profiles.user_id AND driver_rating IS NOT NULL), 5),
    rating_count = (SELECT COUNT(driver_rating) FROM rides WHERE rides.driver_id = driver_profiles.user_id AND driver_rating IS NOT NULL)`);

  // Backfill share tokens / PINs for rides created before those columns existed.
  const stale = db.prepare(`SELECT id FROM rides WHERE share_token IS NULL`).all();
  if (stale.length) {
    const upd = db.prepare('UPDATE rides SET share_token = ?, pin = COALESCE(pin, ?) WHERE id = ?');
    for (const r of stale) {
      upd.run(randomToken(), String(1000 + Math.floor(Math.random() * 9000)), r.id);
    }
  }
}

export function randomToken(bytes = 12) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function seedPricing(db) {
  const upsert = db.prepare(`
    INSERT INTO pricing (vehicle_type,label,description,seats,base_fare,per_km,per_min,min_fare,booking_fee,cancel_fee,currency,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(vehicle_type) DO UPDATE SET cancel_fee = CASE WHEN pricing.cancel_fee = 0 THEN excluded.cancel_fee ELSE pricing.cancel_fee END`);
  for (const p of DEFAULT_PRICING) {
    upsert.run(p.vehicle_type, p.label, p.description, p.seats, p.base_fare, p.per_km, p.per_min, p.min_fare, p.booking_fee, p.cancel_fee, 'INR', p.sort_order);
  }
  // Keep the class order stable when a class is added later (Auto came after Go).
  const order = db.prepare('UPDATE pricing SET sort_order = ? WHERE vehicle_type = ?');
  for (const p of DEFAULT_PRICING) order.run(p.sort_order, p.vehicle_type);
}

function seedPromos(db) {
  const upsert = db.prepare(`
    INSERT INTO promo_codes (code, description, kind, value, max_discount, min_fare, per_user_limit, total_limit)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING`);
  for (const p of DEFAULT_PROMOS) {
    upsert.run(p.code, p.description, p.kind, p.value, p.max_discount, p.min_fare, p.per_user_limit, p.total_limit);
  }
}

export const db = openDatabase();
