import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth, requireRole, loadUser } from '../auth.js';
import { updateDriverLocation } from '../services/drivers.js';

export const driversRouter = Router();
driversRouter.use(requireAuth, requireRole('driver'));

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) =>
      cb(null, `d${req.user.id}_${Date.now()}_${file.originalname.replace(/[^\w.-]/g, '_')}`.slice(0, 120)),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.mimetype)),
});

const DOC_KINDS = ['licence', 'rc', 'insurance', 'permit', 'photo'];

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
  const p = db.prepare('SELECT approval_status FROM driver_profiles WHERE user_id = ?').get(req.user.id);
  if (online && p?.approval_status !== 'approved') {
    return res.status(403).json({ error: 'Your documents are still being reviewed. You cannot go online yet.' });
  }
  if (online && req.user.is_blocked) return res.status(403).json({ error: 'Your account is blocked.' });
  db.prepare('UPDATE driver_profiles SET is_online = ? WHERE user_id = ?').run(online ? 1 : 0, req.user.id);
  res.json({ user: loadUser(req.user.id) });
});

driversRouter.post('/me/location', (req, res) => {
  const { lat, lng, heading } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' });
  updateDriverLocation(req.user.id, lat, lng, Number.isFinite(heading) ? heading : null);
  res.json({ ok: true });
});

/**
 * Earnings ledger for the driver:
 *   + fare of every completed trip
 *   + cancellation fee when a customer cancelled late
 *   - penalty when the driver cancelled after accepting
 */
driversRouter.get('/me/earnings', (req, res) => {
  // The wallet ledger is the source of truth, so these numbers always match the
  // driver's balance: fares are already net of commission, penalties are negative.
  const ledger = (where) =>
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'ride_earning' THEN amount ELSE 0 END), 0)  AS earned,
           COALESCE(SUM(CASE WHEN type = 'cancel_fee'   THEN amount ELSE 0 END), 0)  AS fees,
           COALESCE(SUM(CASE WHEN type = 'cancel_penalty' THEN -amount ELSE 0 END), 0) AS penalties,
           COALESCE(SUM(CASE WHEN type = 'commission'   THEN -amount ELSE 0 END), 0) AS commission
         FROM wallet_transactions WHERE user_id = ? ${where}`,
      )
      .get(req.user.id);
  const trips = (where) =>
    db
      .prepare(
        `SELECT COUNT(*) AS rides,
                COALESCE(SUM(distance_km), 0) AS km,
                COALESCE(SUM(fare_final), 0)  AS gross
         FROM rides WHERE driver_id = ? AND status = 'completed' ${where}`,
      )
      .get(req.user.id);

  const finish = (l, t) => ({
    rides: t.rides,
    km: t.km,
    gross: Math.round(t.gross * 100) / 100,
    earned: Math.round(l.earned * 100) / 100,
    fees: Math.round(l.fees * 100) / 100,
    penalties: Math.round(l.penalties * 100) / 100,
    commission: Math.round(l.commission * 100) / 100,
    net: Math.round((l.earned + l.fees - l.penalties - l.commission) * 100) / 100,
  });

  res.json({
    all_time: finish(ledger(''), trips('')),
    today: finish(ledger(`AND date(created_at) = date('now')`), trips(`AND date(completed_at) = date('now')`)),
    balance: db.prepare('SELECT COALESCE(balance,0) AS b FROM wallets WHERE user_id = ?').get(req.user.id)?.b ?? 0,
  });
});

// ---------------------------------------------------------- onboarding ----
driversRouter.get('/me/documents', (req, res) => {
  const docs = db.prepare('SELECT * FROM driver_documents WHERE driver_id = ? ORDER BY id').all(req.user.id);
  const profile = db.prepare('SELECT approval_status, approval_note FROM driver_profiles WHERE user_id = ?').get(req.user.id);
  res.json({ documents: docs, required: DOC_KINDS, approval: profile });
});

driversRouter.post('/me/documents', upload.single('file'), (req, res) => {
  const kind = String(req.body?.kind || '').toLowerCase();
  if (!DOC_KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${DOC_KINDS.join(', ')}` });
  if (!req.file) return res.status(400).json({ error: 'Attach a photo or PDF (max 8 MB)' });

  // One live document per kind: supersede the old one.
  db.prepare('DELETE FROM driver_documents WHERE driver_id = ? AND kind = ?').run(req.user.id, kind);
  db.prepare('INSERT INTO driver_documents (driver_id, kind, file_path, number, expires_on) VALUES (?,?,?,?,?)').run(
    req.user.id,
    kind,
    path.basename(req.file.path),
    req.body?.number || null,
    req.body?.expires_on || null,
  );
  // Uploading paperwork puts an approved driver back in the queue only if the
  // deployment requires review; otherwise nothing changes.
  if (config.requireDriverApproval) {
    db.prepare(`UPDATE driver_profiles SET approval_status = 'pending' WHERE user_id = ? AND approval_status = 'rejected'`).run(req.user.id);
  }
  res.status(201).json({ documents: db.prepare('SELECT * FROM driver_documents WHERE driver_id = ? ORDER BY id').all(req.user.id) });
});

driversRouter.get('/me/documents/:id/file', (req, res) => {
  const doc = db.prepare('SELECT * FROM driver_documents WHERE id = ? AND driver_id = ?').get(Number(req.params.id), req.user.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(config.uploadDir, doc.file_path));
});
