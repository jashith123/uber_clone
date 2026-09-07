/** Admin panel API. Every route needs a user with is_admin = 1. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { listSos, resolveSos } from '../services/safety.js';
import { listZones, upsertZone, deleteZone } from '../services/surge.js';
import { offersForRide } from '../services/dispatch.js';
import { credit } from '../services/payments.js';

export const adminRouter = Router();

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admins only' });
  next();
}
adminRouter.use(requireAuth, requireAdmin);

// ------------------------------------------------------------- dashboard ----
adminRouter.get('/stats', (_req, res) => {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  res.json({
    users: one(`SELECT
        SUM(role = 'customer') AS riders,
        SUM(role = 'driver') AS drivers,
        SUM(is_blocked = 1) AS blocked
      FROM users`),
    drivers_online: one(`SELECT COUNT(*) AS n FROM driver_profiles WHERE is_online = 1`).n,
    pending_approvals: one(`SELECT COUNT(*) AS n FROM driver_profiles WHERE approval_status = 'pending'`).n,
    rides: one(`SELECT
        COUNT(*) AS total,
        SUM(status = 'completed') AS completed,
        SUM(status = 'cancelled') AS cancelled,
        SUM(status IN ('requested','accepted','arrived','in_progress')) AS active
      FROM rides`),
    today: one(`SELECT
        COUNT(*) AS rides,
        COALESCE(SUM(CASE WHEN status='completed' THEN fare_final ELSE 0 END),0) AS gross,
        COALESCE(SUM(CASE WHEN status='completed' THEN distance_km ELSE 0 END),0) AS km
      FROM rides WHERE date(created_at) = date('now')`),
    revenue: one(`SELECT
        COALESCE(SUM(CASE WHEN status='completed' THEN fare_final ELSE 0 END),0) AS gross_fares,
        COALESCE(SUM(cancel_fee),0) AS cancel_fees
      FROM rides`),
    commission: one(`SELECT COALESCE(-SUM(amount),0) AS total FROM wallet_transactions WHERE type = 'commission'`).total,
    open_sos: one(`SELECT COUNT(*) AS n FROM sos_alerts WHERE status != 'resolved'`).n,
  });
});

adminRouter.get('/rides', (req, res) => {
  const status = req.query.status;
  const rows = db
    .prepare(`SELECT r.id, r.status, r.vehicle_type, r.distance_km, r.fare_estimate, r.fare_final, r.cancel_fee,
                     r.driver_penalty, r.surge_multiplier, r.promo_code, r.discount, r.payment_method, r.payment_status,
                     r.pickup_address, r.dropoff_address, r.created_at, r.dispatch_state,
                     c.name AS customer_name, d.name AS driver_name
              FROM rides r
              JOIN users c ON c.id = r.customer_id
              LEFT JOIN users d ON d.id = r.driver_id
              WHERE (? IS NULL OR r.status = ?)
              ORDER BY r.id DESC LIMIT ?`)
    .all(status || null, status || null, Math.min(Number(req.query.limit) || 50, 200));
  res.json({ rides: rows });
});

adminRouter.get('/rides/:id/offers', (req, res) => res.json({ offers: offersForRide(Number(req.params.id)) }));

// ----------------------------------------------------------------- users ----
adminRouter.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db
    .prepare(`SELECT u.id, u.role, u.name, u.email, u.phone, u.is_admin, u.is_blocked, u.created_at,
                     p.vehicle_type, p.approval_status, p.is_online, p.rating, p.acceptance_rate, p.plate,
                     COALESCE(w.balance, 0) AS balance,
                     (SELECT COUNT(*) FROM rides WHERE customer_id = u.id OR driver_id = u.id) AS rides
              FROM users u
              LEFT JOIN driver_profiles p ON p.user_id = u.id
              LEFT JOIN wallets w ON w.user_id = u.id
              WHERE (? = '%%' OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)
              ORDER BY u.id DESC LIMIT 200`)
    .all(q, q, q, q);
  res.json({ users: rows });
});

adminRouter.post('/users/:id/block', (req, res) => {
  const blocked = req.body?.blocked ? 1 : 0;
  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blocked, Number(req.params.id));
  if (blocked) db.prepare('UPDATE driver_profiles SET is_online = 0 WHERE user_id = ?').run(Number(req.params.id));
  res.json({ ok: true, blocked: Boolean(blocked) });
});

adminRouter.post('/users/:id/credit', (req, res, next) => {
  try {
    const amount = Number(req.body?.amount);
    if (!amount) return res.status(400).json({ error: 'Amount required' });
    const wallet = credit(Number(req.params.id), amount, 'adjustment', { note: req.body?.note || `Adjusted by ${req.user.name}` });
    res.json({ wallet });
  } catch (e) {
    next(e);
  }
});

// --------------------------------------------------- driver verification ----
adminRouter.get('/drivers/pending', (_req, res) => {
  const rows = db
    .prepare(`SELECT u.id, u.name, u.email, u.phone, u.created_at,
                     p.vehicle_type, p.vehicle_make, p.vehicle_model, p.vehicle_color, p.plate, p.approval_status, p.approval_note
              FROM users u JOIN driver_profiles p ON p.user_id = u.id
              WHERE u.role = 'driver' ORDER BY (p.approval_status = 'pending') DESC, u.id DESC`)
    .all();
  const docs = db.prepare('SELECT * FROM driver_documents ORDER BY id').all();
  res.json({
    drivers: rows.map((d) => ({ ...d, documents: docs.filter((x) => x.driver_id === d.id) })),
  });
});

adminRouter.post('/drivers/:id/approval', (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  db.prepare(
    `UPDATE driver_profiles SET approval_status = ?, approval_note = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END WHERE user_id = ?`,
  ).run(status, req.body?.note || null, status, Number(req.params.id));
  if (status !== 'approved') db.prepare('UPDATE driver_profiles SET is_online = 0 WHERE user_id = ?').run(Number(req.params.id));
  res.json({ ok: true, status });
});

adminRouter.post('/documents/:id/review', (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  db.prepare(
    `UPDATE driver_documents SET status = ?, review_note = ?, reviewer_id = ?, reviewed_at = datetime('now') WHERE id = ?`,
  ).run(status, req.body?.note || null, req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

// ----------------------------------------------------------------- fares ----
adminRouter.get('/pricing', (_req, res) => res.json({ pricing: db.prepare('SELECT * FROM pricing ORDER BY sort_order').all() }));

adminRouter.put('/pricing/:type', (req, res) => {
  const fields = ['base_fare', 'per_km', 'per_min', 'min_fare', 'booking_fee', 'cancel_fee', 'label', 'description', 'seats'];
  const patch = fields.filter((f) => req.body?.[f] !== undefined);
  if (!patch.length) return res.status(400).json({ error: 'Nothing to update' });
  db.prepare(`UPDATE pricing SET ${patch.map((f) => `${f} = ?`).join(', ')} WHERE vehicle_type = ?`).run(
    ...patch.map((f) => req.body[f]),
    req.params.type,
  );
  res.json({ pricing: db.prepare('SELECT * FROM pricing WHERE vehicle_type = ?').get(req.params.type) });
});

// ---------------------------------------------------------------- promos ----
adminRouter.get('/promos', (_req, res) => res.json({ promos: db.prepare('SELECT * FROM promo_codes ORDER BY rowid DESC').all() }));

adminRouter.post('/promos', (req, res) => {
  const b = req.body || {};
  if (!b.code) return res.status(400).json({ error: 'Code required' });
  db.prepare(`INSERT INTO promo_codes (code, description, kind, value, max_discount, min_fare, per_user_limit, total_limit, active, expires_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(code) DO UPDATE SET description=excluded.description, kind=excluded.kind, value=excluded.value,
                max_discount=excluded.max_discount, min_fare=excluded.min_fare, per_user_limit=excluded.per_user_limit,
                total_limit=excluded.total_limit, active=excluded.active, expires_at=excluded.expires_at`).run(
    String(b.code).trim(),
    b.description || '',
    b.kind === 'flat' ? 'flat' : 'percent',
    Number(b.value) || 0,
    Number(b.max_discount) || 0,
    Number(b.min_fare) || 0,
    Number(b.per_user_limit) || 1,
    Number(b.total_limit) || 0,
    b.active === false ? 0 : 1,
    b.expires_at || null,
  );
  res.json({ promos: db.prepare('SELECT * FROM promo_codes ORDER BY rowid DESC').all() });
});

adminRouter.delete('/promos/:code', (req, res) => {
  db.prepare('UPDATE promo_codes SET active = 0 WHERE code = ?').run(req.params.code);
  res.json({ ok: true });
});

// ------------------------------------------------------------ surge zones ----
adminRouter.get('/surge', (_req, res) => res.json({ zones: listZones() }));
adminRouter.post('/surge', (req, res) => res.json({ zone: upsertZone(req.body || {}), zones: listZones() }));
adminRouter.delete('/surge/:id', (req, res) => {
  deleteZone(Number(req.params.id));
  res.json({ zones: listZones() });
});

// ------------------------------------------------------------------- sos ----
adminRouter.get('/sos', (req, res) => res.json({ alerts: listSos({ all: req.query.all === '1' }) }));
adminRouter.post('/sos/:id/resolve', (req, res, next) => {
  try {
    res.json({ alert: resolveSos(req.user, Number(req.params.id), req.body?.status || 'resolved') });
  } catch (e) {
    next(e);
  }
});
