import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import {
  createRide,
  getRide,
  listRides,
  activeRideForUser,
  availableRides,
  acceptRide,
  advanceRide,
  cancelRide,
  rateRide,
} from '../services/rides.js';
import { listMessages, sendMessage } from '../services/chat.js';

export const ridesRouter = Router();
ridesRouter.use(requireAuth);

ridesRouter.get('/', (req, res) => {
  res.json({ rides: listRides(req.user, { limit: Math.min(Number(req.query.limit) || 50, 200) }) });
});

ridesRouter.get('/active', (req, res) => {
  res.json({ ride: activeRideForUser(req.user) });
});

ridesRouter.get('/available', requireRole('driver'), (req, res) => {
  res.json({ rides: availableRides(req.user) });
});

ridesRouter.post('/', requireRole('customer'), async (req, res, next) => {
  try {
    res.status(201).json({ ride: await createRide(req.user, req.body) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.get('/:id', (req, res) => {
  const ride = getRide(Number(req.params.id));
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (ride.customer_id !== req.user.id && ride.driver_id !== req.user.id) {
    // Drivers may preview any still-open request.
    if (!(req.user.role === 'driver' && ride.status === 'requested')) {
      return res.status(403).json({ error: 'Not your ride' });
    }
  }
  const events = db.prepare('SELECT type, actor_id, payload, created_at FROM ride_events WHERE ride_id = ? ORDER BY id').all(ride.id);
  res.json({ ride, events });
});

ridesRouter.post('/:id/accept', requireRole('driver'), (req, res, next) => {
  try {
    res.json({ ride: acceptRide(req.user, Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

for (const status of ['arrived', 'in_progress', 'completed']) {
  const path = status === 'in_progress' ? 'start' : status === 'completed' ? 'complete' : status;
  ridesRouter.post(`/:id/${path}`, requireRole('driver'), (req, res, next) => {
    try {
      res.json({ ride: advanceRide(req.user, Number(req.params.id), status) });
    } catch (e) {
      next(e);
    }
  });
}

ridesRouter.post('/:id/cancel', (req, res, next) => {
  try {
    res.json({ ride: cancelRide(req.user, Number(req.params.id), req.body?.reason) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.get('/:id/messages', (req, res, next) => {
  try {
    res.json({ messages: listMessages(req.user, Number(req.params.id)) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.post('/:id/messages', (req, res, next) => {
  try {
    res.status(201).json({ message: sendMessage(req.user, Number(req.params.id), req.body?.body) });
  } catch (e) {
    next(e);
  }
});

ridesRouter.post('/:id/rate', (req, res, next) => {
  try {
    res.json({ ride: rateRide(req.user, Number(req.params.id), req.body?.stars) });
  } catch (e) {
    next(e);
  }
});
