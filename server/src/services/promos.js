/** Promo codes: validation, discount maths and redemption. */
import { db } from '../db.js';
import { config } from '../config.js';

const round2 = (n) => Math.round(n * 100) / 100;

const stmts = {
  code: db.prepare('SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE'),
  userUses: db.prepare('SELECT COUNT(*) AS n FROM promo_redemptions WHERE code = ? COLLATE NOCASE AND user_id = ?'),
  redeem: db.prepare('INSERT INTO promo_redemptions (code, user_id, ride_id, discount) VALUES (?,?,?,?)'),
  bump: db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ? COLLATE NOCASE'),
  listActive: db.prepare(`SELECT code, description, kind, value, max_discount, min_fare, per_user_limit, total_limit, used_count FROM promo_codes
                          WHERE active = 1 AND first_ride_only = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))
                          ORDER BY value DESC`),
  completedRides: db.prepare(`SELECT COUNT(*) AS n FROM rides WHERE customer_id = ? AND status = 'completed'`),
  firstRideCode: db.prepare(`SELECT code FROM promo_codes WHERE first_ride_only = 1 AND active = 1 ORDER BY value DESC LIMIT 1`),
};

/** The welcome offer's code when this rider has never completed a ride, else null. */
export function autoPromoFor(user) {
  if (!user) return null;
  if (stmts.completedRides.get(user.id).n > 0) return null;
  return stmts.firstRideCode.get()?.code ?? null;
}

/**
 * Codes the rider can still use. Fully-used codes and ones this rider has
 * exhausted are left out, so every chip offered on the ride screen works.
 */
export function listPromos(user = null) {
  return stmts.listActive
    .all()
    .filter((p) => !(p.total_limit > 0 && p.used_count >= p.total_limit))
    .filter((p) => !user || stmts.userUses.get(p.code, user.id).n < p.per_user_limit)
    .map(({ per_user_limit, total_limit, used_count, ...p }) => p);
}

/**
 * @returns {{ ok:boolean, reason?:string, code?:string, discount:number, description?:string }}
 */
export function quotePromo(user, rawCode, fare) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, reason: 'No code entered', discount: 0 };

  const p = stmts.code.get(code);
  if (!p) return { ok: false, reason: 'That code does not exist', discount: 0 };
  if (!p.active) return { ok: false, reason: 'That code is no longer active', discount: 0 };
  if (p.expires_at && new Date(`${p.expires_at.replace(' ', 'T')}Z`) < new Date()) {
    return { ok: false, reason: 'That code has expired', discount: 0 };
  }
  if (p.total_limit > 0 && p.used_count >= p.total_limit) {
    return { ok: false, reason: 'That code has been fully used', discount: 0 };
  }
  if (fare < p.min_fare) {
    return { ok: false, reason: `Only for rides over ₹${p.min_fare}`, discount: 0 };
  }
  const used = stmts.userUses.get(p.code, user.id).n;
  if (used >= p.per_user_limit) {
    return { ok: false, reason: 'You have already used this code', discount: 0 };
  }
  if (p.first_ride_only && stmts.completedRides.get(user.id).n > 0) {
    return { ok: false, reason: 'The welcome offer is only for your first ride', discount: 0 };
  }

  let discount = p.kind === 'percent' ? (fare * p.value) / 100 : p.value;
  if (p.max_discount > 0) discount = Math.min(discount, p.max_discount);
  // The welcome offer is "₹50 according to the ride": never more than half of it.
  if (p.first_ride_only) discount = Math.min(discount, (fare * config.incentives.firstRideMaxPct) / 100);
  discount = round2(Math.min(discount, fare)); // never below zero fare

  return { ok: true, code: p.code, discount, description: p.description };
}

/** A cancelled ride gives the code back, so a rider does not lose the welcome offer to a cancellation. */
export function releasePromo(rideId) {
  const row = db.prepare('SELECT code FROM promo_redemptions WHERE ride_id = ?').get(rideId);
  if (!row) return false;
  db.prepare('DELETE FROM promo_redemptions WHERE ride_id = ?').run(rideId);
  db.prepare('UPDATE promo_codes SET used_count = MAX(0, used_count - 1) WHERE code = ? COLLATE NOCASE').run(row.code);
  return true;
}

export function redeemPromo(user, code, rideId, discount) {
  if (!code || !discount) return;
  stmts.redeem.run(code, user.id, rideId, discount);
  stmts.bump.run(code);
}
