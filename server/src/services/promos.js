/** Promo codes: validation, discount maths and redemption. */
import { db } from '../db.js';

const round2 = (n) => Math.round(n * 100) / 100;

const stmts = {
  code: db.prepare('SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE'),
  userUses: db.prepare('SELECT COUNT(*) AS n FROM promo_redemptions WHERE code = ? COLLATE NOCASE AND user_id = ?'),
  redeem: db.prepare('INSERT INTO promo_redemptions (code, user_id, ride_id, discount) VALUES (?,?,?,?)'),
  bump: db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ? COLLATE NOCASE'),
  listActive: db.prepare(`SELECT code, description, kind, value, max_discount, min_fare FROM promo_codes
                          WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
                          ORDER BY value DESC`),
};

export function listPromos() {
  return stmts.listActive.all();
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

  let discount = p.kind === 'percent' ? (fare * p.value) / 100 : p.value;
  if (p.max_discount > 0) discount = Math.min(discount, p.max_discount);
  discount = round2(Math.min(discount, fare)); // never below zero fare

  return { ok: true, code: p.code, discount, description: p.description };
}

export function redeemPromo(user, code, rideId, discount) {
  if (!code || !discount) return;
  stmts.redeem.run(code, user.id, rideId, discount);
  stmts.bump.run(code);
}
