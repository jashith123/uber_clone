/**
 * Money: wallets, the signed transaction ledger, and the payment gateway.
 *
 * Two gateways are supported:
 *   mock     – built in, no account, no keys. Top-ups succeed instantly. This is
 *              what runs by default so the whole flow is testable for free.
 *   razorpay – real cards/UPI. Needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.
 *              Called over plain REST, so no extra dependency.
 *
 * Every fare movement is written to `wallet_transactions` with a signed amount,
 * which is what the app shows as + and - to riders and drivers.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';

export const round2 = (n) => Math.round(n * 100) / 100;

const stmts = {
  wallet: db.prepare('SELECT * FROM wallets WHERE user_id = ?'),
  createWallet: db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, 0) ON CONFLICT(user_id) DO NOTHING'),
  setBalance: db.prepare(`UPDATE wallets SET balance = ?, updated_at = datetime('now') WHERE user_id = ?`),
  addTx: db.prepare(`INSERT INTO wallet_transactions (user_id, amount, balance_after, type, ride_id, note) VALUES (?,?,?,?,?,?)`),
  listTx: db.prepare(`SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`),
  newPayment: db.prepare(`INSERT INTO payments (user_id, ride_id, purpose, provider, provider_order_id, amount, currency, status) VALUES (?,?,?,?,?,?,?,?)`),
  payment: db.prepare('SELECT * FROM payments WHERE id = ?'),
  paymentByOrder: db.prepare('SELECT * FROM payments WHERE provider_order_id = ?'),
  markPaid: db.prepare(`UPDATE payments SET status = 'paid', provider_payment_id = ?, paid_at = datetime('now') WHERE id = ? AND status = 'created'`),
  markFailed: db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`),
};

export function getWallet(userId) {
  stmts.createWallet.run(userId);
  return stmts.wallet.get(userId) || { user_id: userId, balance: 0, currency: 'INR' };
}

export function listTransactions(userId, limit = 50) {
  return stmts.listTx.all(userId, limit);
}

/**
 * Move money into (+) or out of (-) a wallet and record it.
 * `allowNegative` lets a driver's balance go below zero for a penalty.
 */
export function credit(userId, amount, type, { rideId = null, note = null, allowNegative = true } = {}) {
  const amt = round2(Number(amount) || 0);
  if (!amt) return getWallet(userId);
  const w = getWallet(userId);
  const next = round2(w.balance + amt);
  if (next < 0 && !allowNegative) {
    throw Object.assign(new Error('Not enough balance in your wallet'), { status: 402 });
  }
  stmts.setBalance.run(next, userId);
  stmts.addTx.run(userId, amt, next, type, rideId, note);
  return { ...w, balance: next };
}

export const debit = (userId, amount, type, opts = {}) => credit(userId, -Math.abs(amount), type, opts);

/**
 * Settle a completed ride: the rider pays, the driver is credited the fare minus
 * the platform commission. Cash rides move no wallet money for the rider, but the
 * driver still owes commission, so it is deducted from their balance.
 */
export function settleRide(ride) {
  const total = round2(ride.fare_final ?? ride.fare_estimate);
  const commission = round2((total * config.payments.commissionPercent) / 100);
  const driverShare = round2(total - commission);

  if (ride.payment_method === 'wallet') {
    debit(ride.customer_id, total, 'ride_fare', { rideId: ride.id, note: `Ride #${ride.id}`, allowNegative: false });
    credit(ride.driver_id, driverShare, 'ride_earning', { rideId: ride.id, note: `Ride #${ride.id} (after ${config.payments.commissionPercent}% commission)` });
  } else if (ride.payment_method === 'cash') {
    // Rider paid the driver directly; the driver owes us commission.
    debit(ride.driver_id, commission, 'commission', { rideId: ride.id, note: `Commission on cash ride #${ride.id}` });
  } else {
    // card: charged through the gateway, so only the driver's side is a wallet move
    credit(ride.driver_id, driverShare, 'ride_earning', { rideId: ride.id, note: `Ride #${ride.id} (after ${config.payments.commissionPercent}% commission)` });
  }
  db.prepare(`UPDATE rides SET payment_status = 'paid' WHERE id = ?`).run(ride.id);
  return { total, commission, driverShare };
}

/** Late-cancellation fee: rider pays, driver receives it (no commission taken). */
export function settleCancellation(ride) {
  if (ride.cancel_fee > 0 && ride.driver_id) {
    debit(ride.customer_id, ride.cancel_fee, 'cancel_fee', { rideId: ride.id, note: `Late cancellation of ride #${ride.id}` });
    credit(ride.driver_id, ride.cancel_fee, 'cancel_fee', { rideId: ride.id, note: `Rider cancelled ride #${ride.id} late` });
  }
  if (ride.driver_penalty > 0 && ride.driver_id) {
    debit(ride.driver_id, ride.driver_penalty, 'cancel_penalty', { rideId: ride.id, note: `You cancelled ride #${ride.id} after accepting` });
  }
}

// ---------------------------------------------------------------- gateway ----

export function gatewayInfo() {
  return {
    provider: config.payments.provider,
    live: config.payments.provider === 'razorpay' && Boolean(config.payments.razorpayKeyId),
    key_id: config.payments.provider === 'razorpay' ? config.payments.razorpayKeyId : null,
    currency: 'INR',
    commission_percent: config.payments.commissionPercent,
  };
}

/** Start a wallet top-up. Returns what the client needs to open the checkout. */
export async function createTopup(user, amountRupees) {
  const amount = round2(Number(amountRupees));
  if (!(amount > 0) || amount > 100000) throw Object.assign(new Error('Enter an amount between 1 and 100000'), { status: 400 });

  const provider = config.payments.provider === 'razorpay' && config.payments.razorpayKeyId ? 'razorpay' : 'mock';
  let orderId = `mock_${crypto.randomUUID()}`;

  if (provider === 'razorpay') {
    const auth = Buffer.from(`${config.payments.razorpayKeyId}:${config.payments.razorpayKeySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt: `topup_${user.id}_${Date.now()}` }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`Payment gateway error: ${text.slice(0, 160)}`), { status: 502 });
    }
    orderId = (await res.json()).id;
  }

  const r = stmts.newPayment.run(user.id, null, 'wallet_topup', provider, orderId, amount, 'INR', 'created');
  return {
    payment_id: Number(r.lastInsertRowid),
    provider,
    order_id: orderId,
    amount,
    currency: 'INR',
    key_id: provider === 'razorpay' ? config.payments.razorpayKeyId : null,
  };
}

/**
 * Confirm a top-up. For razorpay the signature is verified; for the mock gateway
 * confirmation simply succeeds (that is the point of the mock).
 */
export function confirmTopup(user, { payment_id, razorpay_payment_id, razorpay_order_id, razorpay_signature }) {
  const p = stmts.payment.get(Number(payment_id));
  if (!p) throw Object.assign(new Error('Payment not found'), { status: 404 });
  if (p.user_id !== user.id) throw Object.assign(new Error('Not your payment'), { status: 403 });
  if (p.status === 'paid') return { payment: p, wallet: getWallet(user.id) };

  if (p.provider === 'razorpay') {
    const expected = crypto
      .createHmac('sha256', config.payments.razorpaySecret || config.payments.razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expected !== razorpay_signature) {
      stmts.markFailed.run(p.id);
      throw Object.assign(new Error('Payment signature did not verify'), { status: 400 });
    }
  }

  stmts.markPaid.run(razorpay_payment_id || `mock_paid_${Date.now()}`, p.id);
  const wallet = credit(user.id, p.amount, 'topup', { note: `Wallet top-up via ${p.provider}` });
  return { payment: stmts.payment.get(p.id), wallet };
}

/** Driver cashing out. Recorded as a payout; real bank transfer is out of scope. */
export function requestPayout(user, amountRupees) {
  const amount = round2(Number(amountRupees));
  const w = getWallet(user.id);
  if (!(amount > 0)) throw Object.assign(new Error('Enter an amount'), { status: 400 });
  if (amount > w.balance) throw Object.assign(new Error('That is more than your balance'), { status: 400 });
  return debit(user.id, amount, 'payout', { note: 'Payout requested (bank transfer handled outside the app)' });
}
