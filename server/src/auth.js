import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';

/** Sessions last 90 days and are silently renewed on use (see /auth/me). */
export const TOKEN_TTL = '90d';
export const RENEW_AFTER_SECONDS = 24 * 60 * 60;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

export function loadUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;
  const out = publicUser(user);
  if (user.role === 'driver') {
    out.driver = db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?').get(id) || null;
    if (out.driver) {
      // The honest figure: the average of every rating received, none yet = null.
      const r = db.prepare('SELECT AVG(driver_rating) AS avg, COUNT(driver_rating) AS n FROM rides WHERE driver_id = ? AND driver_rating IS NOT NULL').get(id);
      out.driver.rating = r.n ? Math.round(r.avg * 10) / 10 : null;
      out.driver.rating_count = r.n;
    }
  } else {
    const r = db.prepare('SELECT AVG(customer_rating) AS avg, COUNT(customer_rating) AS n FROM rides WHERE customer_id = ? AND customer_rating IS NOT NULL').get(id);
    out.rating = r.n ? Math.round(r.avg * 10) / 10 : null;
    out.rating_count = r.n;
  }
  return out;
}

/** Express middleware: requires a valid Bearer token; attaches req.user and req.tokenIssuedAt. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = verifyToken(token);
    const user = loadUser(payload.sub);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    req.tokenIssuedAt = payload.iat || 0;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (req.user.role !== role) return res.status(403).json({ error: `Requires ${role} account` });
    next();
  };
}

/** Express middleware: the company owner only (OWNER_EMAILS). Owners are admins as well. */
export function requireOwner(req, res, next) {
  if (!req.user?.is_owner) return res.status(403).json({ error: 'Owner only' });
  next();
}
