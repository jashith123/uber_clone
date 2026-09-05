import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, loadUser, RENEW_AFTER_SECONDS } from '../auth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post('/register', (req, res) => {
  const { name, email, phone, password, role = 'customer', vehicle } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['customer', 'driver'].includes(role)) return res.status(400).json({ error: 'role must be customer or driver' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists' });

  const insert = db.prepare('INSERT INTO users (role, name, email, phone, password_hash) VALUES (?,?,?,?,?)');
  const result = insert.run(role, String(name).trim(), String(email).trim(), phone ? String(phone).trim() : null, hashPassword(password));
  const id = Number(result.lastInsertRowid);

  if (role === 'driver') {
    const v = vehicle || {};
    db.prepare(
      'INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_make, vehicle_model, vehicle_color, plate) VALUES (?,?,?,?,?,?)',
    ).run(id, v.vehicle_type || 'economy', v.make || null, v.model || null, v.color || null, v.plate || null);
  }

  const user = loadUser(id);
  res.status(201).json({ token: signToken(user), user });
});

/**
 * POST /api/auth/login { email, password, role? }
 * When `role` is given ("customer" or "driver") the credentials must belong to
 * that kind of account, so customer credentials never open the driver side.
 */
authRouter.post('/login', (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (role && ['customer', 'driver'].includes(role) && row.role !== role) {
    const wanted = role === 'driver' ? 'driver' : 'rider';
    const actual = row.role === 'driver' ? 'driver' : 'rider';
    return res.status(403).json({
      error: `These are ${actual} credentials. Switch to "I'm a ${actual}" to log in, or create a ${wanted} account.`,
      role: row.role,
    });
  }
  const user = loadUser(row.id);
  res.json({ token: signToken(user), user });
});

/** Current user. Also hands back a fresh token once a day so sessions never lapse while the app is in use. */
authRouter.get('/me', requireAuth, (req, res) => {
  const age = Math.floor(Date.now() / 1000) - (req.tokenIssuedAt || 0);
  res.json({ user: req.user, ...(age > RENEW_AFTER_SECONDS ? { token: signToken(req.user) } : {}) });
});
