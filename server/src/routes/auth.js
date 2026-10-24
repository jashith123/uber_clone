import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, loadUser, RENEW_AFTER_SECONDS } from '../auth.js';
import { config } from '../config.js';
import { getWallet } from '../services/payments.js';
import { sendOtp, verifyOtp, phoneFromToken, normalizePhone } from '../services/otp.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Errors thrown by the services carry an HTTP status; anything else is a 500. */
function fail(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

/**
 * POST /api/auth/otp/send { phone, purpose: 'signup' | 'reset' }
 * Sends a 6-digit code to the phone. With the console provider the code is
 * printed in the server log and, while the demo password is in use, returned
 * as `demo_code` so the app can show it.
 */
authRouter.post('/otp/send', async (req, res) => {
  try {
    const { phone, purpose = 'signup' } = req.body || {};
    const { demo_code, sent, expires_in_min } = await sendOtp(phone, purpose);
    res.json({ ok: true, sent, expires_in_min, ...(demo_code ? { demo_code } : {}) });
  } catch (err) {
    fail(res, err);
  }
});

/** POST /api/auth/otp/verify { phone, code, purpose } → { otp_token } for register / reset. */
authRouter.post('/otp/verify', (req, res) => {
  try {
    const { phone, code, purpose = 'signup' } = req.body || {};
    res.json(verifyOtp(phone, code, purpose));
  } catch (err) {
    fail(res, err);
  }
});

/** POST /api/auth/reset { otp_token, password }  Sets a new password for the account on the verified phone. */
authRouter.post('/reset', (req, res) => {
  const { otp_token, password } = req.body || {};
  const phone = phoneFromToken(otp_token, 'reset');
  if (!phone) return res.status(400).json({ error: 'Verify your phone number first. The code is valid for 15 minutes.' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const rows = db.prepare('SELECT id FROM users WHERE phone = ?').all(phone);
  if (!rows.length) return res.status(404).json({ error: 'No account uses that number' });
  if (rows.length > 1) return res.status(409).json({ error: 'More than one account uses this number. Contact support to reset the password.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), rows[0].id);
  res.json({ ok: true });
});

authRouter.post('/register', (req, res) => {
  const { name, email, password, role = 'customer', vehicle, otp_token } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!['customer', 'driver'].includes(role)) return res.status(400).json({ error: 'role must be customer or driver' });

  // The phone is the verified one when verification is on; otherwise whatever was typed.
  let phone = null;
  if (config.requirePhoneOtp) {
    phone = phoneFromToken(otp_token, 'signup');
    if (!phone) return res.status(400).json({ error: 'Verify your mobile number first. The code is valid for 15 minutes.' });
  } else if (req.body?.phone) {
    phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid mobile number, for example +91 98765 43210' });
  }
  if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) {
    return res.status(409).json({ error: 'That number already has an account. Log in, or reset the password.' });
  }

  if (role === 'driver') {
    const v = vehicle || {};
    if (![v.make, v.model, v.color, v.plate].every((x) => String(x || '').trim())) {
      return res.status(400).json({ error: 'Drivers must register their vehicle: make, model, colour and number plate.' });
    }
    if (!db.prepare('SELECT 1 FROM pricing WHERE vehicle_type = ?').get(v.vehicle_type || 'economy')) {
      return res.status(400).json({ error: 'Unknown vehicle class' });
    }
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists' });

  const lower = String(email).trim().toLowerCase();
  const isOwner = config.ownerEmails.includes(lower) ? 1 : 0;
  const isAdmin = isOwner || config.adminEmails.includes(lower) ? 1 : 0;
  const insert = db.prepare('INSERT INTO users (role, name, email, phone, password_hash, is_admin, is_owner) VALUES (?,?,?,?,?,?,?)');
  const result = insert.run(role, String(name).trim(), String(email).trim(), phone, hashPassword(password), isAdmin, isOwner);
  const id = Number(result.lastInsertRowid);
  getWallet(id); // every account gets a wallet from day one

  if (role === 'driver') {
    const v = vehicle || {};
    db.prepare(
      'INSERT INTO driver_profiles (user_id, vehicle_type, vehicle_make, vehicle_model, vehicle_color, plate, approval_status) VALUES (?,?,?,?,?,?,?)',
    ).run(
      id, v.vehicle_type || 'economy', v.make || null, v.model || null, v.color || null, v.plate || null,
      config.requireDriverApproval ? 'pending' : 'approved',
    );
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
  if (row.is_blocked) {
    return res.status(403).json({ error: 'This account has been blocked. Contact support.' });
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

/**
 * GET /api/auth/demo   Whether the demo accounts exist on this server, and
 * their password while it is still the default (so the login page can print
 * it). Once DEMO_PASSWORD is set, the password is no longer given out.
 */
authRouter.get('/demo', (_req, res) => {
  const enabled = Boolean(db.prepare(`SELECT 1 FROM users WHERE email IN ('rider@demo.com', 'customer@demo.com')`).get());
  res.json({ enabled, password: enabled && config.demoPassword === 'password' ? 'password' : null, phone_otp: config.requirePhoneOtp });
});

/** Current user. Also hands back a fresh token once a day so sessions never lapse while the app is in use. */
authRouter.get('/me', requireAuth, (req, res) => {
  const age = Math.floor(Date.now() / 1000) - (req.tokenIssuedAt || 0);
  res.json({ user: req.user, ...(age > RENEW_AFTER_SECONDS ? { token: signToken(req.user) } : {}) });
});
