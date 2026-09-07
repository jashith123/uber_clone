import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { publicTrip, listContacts, addContact, removeContact, raiseSos } from '../services/safety.js';

export const safetyRouter = Router();

/** Public: anyone holding the share link can follow the trip. No login. */
safetyRouter.get('/trip/:token', (req, res, next) => {
  try {
    res.json({ trip: publicTrip(req.params.token) });
  } catch (e) {
    next(e);
  }
});

safetyRouter.use(requireAuth);

safetyRouter.get('/contacts', (req, res) => res.json({ contacts: listContacts(req.user.id) }));

safetyRouter.post('/contacts', (req, res, next) => {
  try {
    res.status(201).json({ contacts: addContact(req.user.id, req.body?.name, req.body?.phone) });
  } catch (e) {
    next(e);
  }
});

safetyRouter.delete('/contacts/:id', (req, res) => {
  res.json({ contacts: removeContact(req.user.id, Number(req.params.id)) });
});

safetyRouter.post('/sos', (req, res, next) => {
  try {
    res.status(201).json(raiseSos(req.user, req.body || {}));
  } catch (e) {
    next(e);
  }
});
