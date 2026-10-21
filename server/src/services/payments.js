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

// ---------------------------------------------------------- company ledger ----
// The company's own money, as a signed ledger like a wallet:
//   topup          + money a rider or driver added (held on their behalf)
//   collection     + a fare paid online: wallet, card or the company QR
//   commission     + the commission taken from a driver who collected a fare himself
//   driver_payout  − money paid out to a driver's bank account
const companyStmts = {
  last: db.prepare('SELECT balance_after FROM company_ledger ORDER BY id DESC LIMIT 1'),
  add: db.prepare('INSERT INTO company_ledger (amount, balance_after, type, ride_id, user_id, note) VALUES (?,?,?,?,?,?)'),
  list: db.prepare('SELECT * FROM company_ledger ORDER BY id DESC LIMIT ?'),
  sumType: db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM company_ledger WHERE type = ?'),
};

export function companyBalance() {
  return companyStmts.last.get()?.balance_after ?? 0;
}

export function companyEntry(amount, type, { rideId = null, userId = null, note = null } = {}) {
  const amt = round2(Number(amount) || 0);
  if (!amt) return companyBalance();
  const next = round2(companyBalance() + amt);
  companyStmts.add.run(amt, next, type, rideId, userId, note);
  return next;
}

export function companyLedger(limit = 100) {
  return companyStmts.list.all(limit);
}

export function companyTotal(type) {
  return round2(companyStmts.sumType.get(type).s);
}

/** The platform's cut of a fare. */
export const commissionFor = (fare) => round2((Number(fare) * config.payments.commissionPercent) / 100);

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
  // Money added by a rider or driver is held by the company on their behalf.
  if (type === 'topup') companyEntry(amt, 'topup', { userId, note });
  return { ...w, balance: next };
}

export const debit = (userId, amount, type, opts = {}) => credit(userId, -Math.abs(amount), type, opts);

/**
 * Settle a completed ride: the rider pays, the driver is credited the fare minus
 * the platform commission. Cash rides move no wallet money for the rider, but the
 * driver still owes commission, so it is deducted from their balance.
 */
export function settleRide(ride, collectedVia = null) {
  const fare = round2(ride.fare_final ?? ride.fare_estimate); // what the rider pays
  const due = round2(ride.due_carried || 0); // a cancellation fee the rider still owed
  const total = round2(fare + due);
  // The driver is paid on the fare before any welcome offer: the company, not
  // the driver, pays for the rider's discount.
  const gross = round2(fare + (ride.discount || 0));
  // A driver's first rides are commission-free (DRIVER_FREE_RIDES).
  const paidBefore = db.prepare(`SELECT COUNT(*) AS n FROM rides WHERE driver_id = ? AND status = 'completed' AND payment_status = 'paid' AND id <> ?`).get(ride.driver_id, ride.id).n;
  const freeRide = paidBefore < config.incentives.freeRidesPerDriver;
  const fullCommission = commissionFor(gross);
  const commission = freeRide ? 0 : fullCommission;
  const driverShare = round2(gross - commission);
  const pct = config.payments.commissionPercent;

  // The rider's wallet paid first (worked out when the car reached the
  // destination); the remainder was collected on the company QR, by card, or
  // by the driver in person. The driver ends up with his share either way:
  // what he collected in hand counts against it.
  const walletPaid = round2(ride.wallet_paid || 0);
  const remainder = round2(total - walletPaid);
  let via = collectedVia;
  if (remainder <= 0) via = 'wallet';
  else if (ride.payment_method === 'card') via = 'card';
  else if (!via) via = 'driver';

  if (walletPaid > 0) {
    debit(ride.customer_id, walletPaid, 'ride_fare', { rideId: ride.id, note: `Ride #${ride.id}`, allowNegative: false });
    companyEntry(walletPaid, 'collection', { rideId: ride.id, userId: ride.customer_id, note: `Ride #${ride.id} paid from wallet` });
  }
  let cashInHand = 0;
  if (remainder > 0) {
    if (via === 'driver') cashInHand = remainder;
    else companyEntry(remainder, 'collection', { rideId: ride.id, userId: ride.customer_id, note: `Ride #${ride.id} paid by ${via === 'card' ? 'card' : 'company QR'}` });
  }
  const movement = round2(driverShare - cashInHand);
  if (movement > 0) {
    credit(ride.driver_id, movement, 'ride_earning', {
      rideId: ride.id,
      note: `Ride #${ride.id}: ${freeRide ? 'the whole fare (commission-free ride)' : `your ${100 - pct}% share`}${cashInHand ? ` less ₹${cashInHand.toFixed(2)} collected in hand` : ''}`,
    });
  } else if (movement < 0) {
    // He collected more than his share in cash: the commission (and any fee the
    // rider owed) comes out of his wallet, which was checked before the ride.
    debit(ride.driver_id, -movement, 'commission', { rideId: ride.id, note: `Ride #${ride.id}: ${pct}% commission${due ? " and the rider's carried fee" : ''} on cash you collected` });
    const feePart = round2(Math.min(due, -movement));
    if (feePart > 0) companyEntry(feePart, 'collection', { rideId: ride.id, userId: ride.driver_id, note: `Carried fee on ride #${ride.id} recovered via the driver` });
    if (round2(-movement - feePart) > 0) companyEntry(round2(-movement - feePart), 'commission', { rideId: ride.id, userId: ride.driver_id, note: `Commission on ride #${ride.id}` });
  }
  if (due > 0) db.prepare('UPDATE users SET outstanding_fee = MAX(0, ROUND(outstanding_fee - ?, 2)) WHERE id = ?').run(due, ride.customer_id);
  db.prepare(`UPDATE rides SET payment_status = 'paid', collected_via = ?, commission = ?, driver_share = ?, commission_waived = ? WHERE id = ?`).run(
    via, commission, driverShare, freeRide ? fullCommission : 0, ride.id,
  );
  return { total, fare, due, walletPaid, remainder, commission, driverShare, via, freeRide };
}

/**
 * Late-cancellation fee: taken from the rider's wallet as far as it goes; the
 * rest rides along to their next trip (a rider's wallet never goes negative).
 * The driver receives the whole fee now; the company fronts any unpaid part
 * and recovers it with the rider's next fare.
 */
export function settleCancellation(ride) {
  if (ride.cancel_fee > 0 && ride.driver_id) {
    const w = getWallet(ride.customer_id);
    const fromWallet = round2(Math.min(Math.max(0, w.balance), ride.cancel_fee));
    const carried = round2(ride.cancel_fee - fromWallet);
    if (fromWallet > 0) debit(ride.customer_id, fromWallet, 'cancel_fee', { rideId: ride.id, note: `Late cancellation of ride #${ride.id}`, allowNegative: false });
    if (carried > 0) db.prepare('UPDATE users SET outstanding_fee = ROUND(outstanding_fee + ?, 2) WHERE id = ?').run(carried, ride.customer_id);
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

/** A driver asks to be paid. The owner pays it from the Company tab; nothing moves until then. */
export function requestPayout(user, amountRupees) {
  const amount = round2(Number(amountRupees));
  const w = getWallet(user.id);
  if (!(amount > 0)) throw Object.assign(new Error('Enter an amount'), { status: 400 });
  if (amount > w.balance) throw Object.assign(new Error('That is more than your balance'), { status: 400 });
  db.prepare(`UPDATE driver_profiles SET payout_requested = ?, payout_requested_at = datetime('now') WHERE user_id = ?`).run(amount, user.id);
  return { ...w, payout_requested: amount };
}

/** The owner pays a driver. The bank transfer happens outside the app; this records it on both sides. */
export function payDriver(driverId, amountRupees, note = null) {
  const amount = round2(Number(amountRupees));
  const w = getWallet(driverId);
  if (!(amount > 0)) throw Object.assign(new Error('Enter an amount'), { status: 400 });
  if (amount > w.balance) throw Object.assign(new Error(`The driver's wallet only holds ₹${w.balance.toFixed(2)}`), { status: 400 });
  const out = debit(driverId, amount, 'payout', { note: note || 'Paid out by the company' });
  companyEntry(-amount, 'driver_payout', { userId: driverId, note: note || `Payout to driver #${driverId}` });
  db.prepare(
    `UPDATE driver_profiles SET payout_requested = MAX(0, payout_requested - ?),
       payout_requested_at = CASE WHEN payout_requested - ? <= 0 THEN NULL ELSE payout_requested_at END WHERE user_id = ?`,
  ).run(amount, amount, driverId);
  return out;
}
