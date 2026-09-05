import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole, loadUser } from '../auth.js';
import { updateDriverLocation } from '../services/drivers.js';

export const driversRouter = Router();
driversRouter.use(requireAuth, requireRole('driver'));

driversRouter.put('/me', (req, res) => {
  const { vehicle_type, make, model, color, plate } = req.body || {};
  const valid = db.prepare('SELECT 1 FROM pricing WHERE vehicle_type = ?').get(vehicle_type || 'economy');
  if (vehicle_type && !valid) return res.status(400).json({ error: 'Unknown vehicle type' });
  db.prepare(
    `UPDATE driver_profiles SET
       vehicle_type = COALESCE(?, vehicle_type),
       vehicle_make = COALESCE(?, vehicle_make),
       vehicle_model = COALESCE(?, vehicle_model),
       vehicle_color = COALESCE(?, vehicle_color),
       plate = COALESCE(?, plate)
     WHERE user_id = ?`,
  ).run(vehicle_type ?? null, make ?? null, model ?? null, color ?? null, plate ?? null, req.user.id);
  res.json({ user: loadUser(req.user.id) });
});

driversRouter.post('/me/status', (req, res) => {
  const online = Boolean(req.body?.online);
  db.prepare('UPDATE driver_profiles SET is_online = ? WHERE user_id = ?').run(online ? 1 : 0, req.user.id);
  res.json({ user: loadUser(req.user.id) });
});

driversRouter.post('/me/location', (req, res) => {
  const { lat, lng, heading } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' });
  updateDriverLocation(req.user.id, lat, lng, Number.isFinite(heading) ? heading : null);
  res.json({ ok: true });
});

driversRouter.get('/me/earnings', (req, res) => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS rides, COALESCE(SUM(fare_final),0) AS total, COALESCE(SUM(distance_km),0) AS km
       FROM rides WHERE driver_id = ? AND status = 'completed'`,
    )
    .get(req.user.id);
  const today = db
    .prepare(
      `SELECT COUNT(*) AS rides, COALESCE(SUM(fare_final),0) AS total
       FROM rides WHERE driver_id = ? AND status = 'completed' AND date(completed_at) = date('now')`,
    )
    .get(req.user.id);
  res.json({ all_time: totals, today });
});
