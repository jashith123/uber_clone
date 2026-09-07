import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { pushEnabled, publicKey, subscribe, unsubscribe, sendToUser } from '../services/push.js';

export const pushRouter = Router();

/** The browser needs the public VAPID key before it can subscribe. */
pushRouter.get('/config', (_req, res) => res.json({ enabled: pushEnabled(), public_key: publicKey() }));

pushRouter.use(requireAuth);

pushRouter.post('/subscribe', (req, res, next) => {
  try {
    res.json(subscribe(req.user.id, req.body?.subscription));
  } catch (e) {
    next(e);
  }
});

pushRouter.post('/unsubscribe', (req, res) => res.json(unsubscribe(req.body?.endpoint)));

/** Handy while setting the feature up on a new phone. */
pushRouter.post('/test', async (req, res, next) => {
  try {
    res.json(await sendToUser(req.user.id, { title: 'SwiftRide', body: 'Notifications are working.', url: '/' }));
  } catch (e) {
    next(e);
  }
});
