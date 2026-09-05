import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { geocode, reverseGeocode, fetchRoutes } from '../services/geo.js';
import { quoteAll } from '../services/fare.js';

export const geoRouter = Router();

geoRouter.get('/pricing', (_req, res) => {
  res.json({ pricing: db.prepare('SELECT * FROM pricing ORDER BY sort_order').all() });
});

geoRouter.get('/geocode', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const near =
      req.query.lat && req.query.lng ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : undefined;
    res.json({ results: await geocode(q, { near }) });
  } catch (e) {
    next(e);
  }
});

geoRouter.get('/reverse', requireAuth, async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' });
    res.json({ result: await reverseGeocode(lat, lng) });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/geo/routes  { waypoints: [{lat,lng}, ...] }
 * Returns every route option with a fare quote per vehicle class.
 * This is what powers "choose your own route": the customer sees the
 * alternatives (or their custom via-point route) with km + price for each.
 */
geoRouter.post('/routes', requireAuth, async (req, res, next) => {
  try {
    const { waypoints } = req.body || {};
    if (!Array.isArray(waypoints) || waypoints.length < 2 || waypoints.length > 8) {
      return res.status(400).json({ error: 'Provide between 2 and 8 waypoints' });
    }
    for (const w of waypoints) {
      if (!Number.isFinite(w?.lat) || !Number.isFinite(w?.lng)) {
        return res.status(400).json({ error: 'Each waypoint needs numeric lat and lng' });
      }
    }
    const pricing = db.prepare('SELECT * FROM pricing ORDER BY sort_order').all();
    const routes = await fetchRoutes(waypoints);
    res.json({
      routes: routes.map((r) => ({ ...r, quotes: quoteAll(pricing, r.distance_km, r.duration_min) })),
    });
  } catch (e) {
    next(e);
  }
});
