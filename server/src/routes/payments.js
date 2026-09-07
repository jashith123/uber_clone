import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { getWallet, listTransactions, createTopup, confirmTopup, requestPayout, gatewayInfo } from '../services/payments.js';

export const paymentsRouter = Router();

/** Which gateway is live. Public so the checkout page knows what to load. */
paymentsRouter.get('/config', (_req, res) => res.json(gatewayInfo()));

paymentsRouter.use(requireAuth);

paymentsRouter.get('/wallet', (req, res) => {
  res.json({
    wallet: getWallet(req.user.id),
    transactions: listTransactions(req.user.id, Math.min(Number(req.query.limit) || 50, 200)),
  });
});

/** Step 1 of a top-up: create the order. */
paymentsRouter.post('/topup', async (req, res, next) => {
  try {
    res.json(await createTopup(req.user, req.body?.amount));
  } catch (e) {
    next(e);
  }
});

/** Step 2: confirm it (mock succeeds; razorpay verifies the signature). */
paymentsRouter.post('/topup/confirm', (req, res, next) => {
  try {
    res.json(confirmTopup(req.user, req.body || {}));
  } catch (e) {
    next(e);
  }
});

paymentsRouter.post('/payout', requireRole('driver'), (req, res, next) => {
  try {
    res.json({ wallet: requestPayout(req.user, req.body?.amount) });
  } catch (e) {
    next(e);
  }
});
