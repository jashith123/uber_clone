/**
 * Wipe every ride and every transaction so the books show only what was
 * actually done from now on. Accounts, vehicles, prices and promo codes stay.
 * Used by the owner's "Reset demo data" button and `node scripts/reset-demo.mjs`.
 */
import { db } from '../db.js';

export function resetDemoData() {
  db.exec('BEGIN');
  try {
    for (const t of ['ride_events', 'ride_offers', 'ride_messages', 'promo_redemptions', 'sos_alerts', 'payments', 'wallet_transactions', 'company_ledger', 'rides']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec(`UPDATE wallets SET balance = 0, updated_at = datetime('now')`);
    db.exec(`UPDATE users SET outstanding_fee = 0`);
    db.exec(`UPDATE driver_profiles SET rating = 5, rating_count = 0, payout_requested = 0, payout_requested_at = NULL,
             offers_seen = 0, offers_taken = 0, acceptance_rate = 100`);
    db.exec(`UPDATE promo_codes SET used_count = 0`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('rides','ride_events','ride_offers','ride_messages','payments','wallet_transactions','company_ledger','sos_alerts')`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}
