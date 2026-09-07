/**
 * Demand pricing.
 *
 * Two sources, whichever is higher:
 *   1. An admin-defined surge zone the pickup falls inside.
 *   2. Live demand: waiting riders vs online drivers of that class nearby.
 *
 * The multiplier is applied to the distance and time part of the fare only, so
 * the base fare and booking fee never surge.
 */
import { db } from '../db.js';

const round1 = (n) => Math.round(n * 10) / 10;
const MAX_MULTIPLIER = 2.5;

const stmts = {
  zones: db.prepare('SELECT * FROM surge_zones WHERE active = 1'),
  waiting: db.prepare(`SELECT pickup_lat AS lat, pickup_lng AS lng FROM rides WHERE status = 'requested' AND vehicle_type = ?`),
  online: db.prepare(`SELECT lat, lng FROM driver_profiles WHERE is_online = 1 AND lat IS NOT NULL AND vehicle_type = ?`),
};

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** @returns {{ multiplier:number, reason:string|null }} */
export function surgeAt(point, vehicleType) {
  let multiplier = 1;
  let reason = null;

  for (const z of stmts.zones.all()) {
    if (haversineKm(point, z) <= z.radius_km && z.multiplier > multiplier) {
      multiplier = z.multiplier;
      reason = `High demand in ${z.name}`;
    }
  }

  const RADIUS = 5;
  const waiting = stmts.waiting.all(vehicleType).filter((r) => haversineKm(point, r) <= RADIUS).length;
  const drivers = stmts.online.all(vehicleType).filter((d) => haversineKm(point, d) <= RADIUS).length;
  if (waiting >= 2 && waiting > drivers) {
    const live = 1 + Math.min(1.5, (waiting - drivers) * 0.2);
    if (live > multiplier) {
      multiplier = live;
      reason = `${waiting} riders waiting, ${drivers} cars nearby`;
    }
  }

  return { multiplier: round1(Math.min(multiplier, MAX_MULTIPLIER)), reason: multiplier > 1 ? reason : null };
}

export function listZones() {
  return db.prepare('SELECT * FROM surge_zones ORDER BY id').all();
}

export function upsertZone({ id, name, lat, lng, radius_km = 3, multiplier = 1, active = 1 }) {
  if (id) {
    db.prepare(
      `UPDATE surge_zones SET name=?, lat=?, lng=?, radius_km=?, multiplier=?, active=?, updated_at=datetime('now') WHERE id=?`,
    ).run(name, lat, lng, radius_km, multiplier, active ? 1 : 0, id);
    return db.prepare('SELECT * FROM surge_zones WHERE id = ?').get(id);
  }
  const r = db
    .prepare('INSERT INTO surge_zones (name, lat, lng, radius_km, multiplier, active) VALUES (?,?,?,?,?,?)')
    .run(name, lat, lng, radius_km, multiplier, active ? 1 : 0);
  return db.prepare('SELECT * FROM surge_zones WHERE id = ?').get(Number(r.lastInsertRowid));
}

export function deleteZone(id) {
  db.prepare('DELETE FROM surge_zones WHERE id = ?').run(id);
}
