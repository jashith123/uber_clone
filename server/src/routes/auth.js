import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, loadUser } from '../auth.js';

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

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const user = loadUser(row.id);
  res.json({ token: signToken(user), user });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
