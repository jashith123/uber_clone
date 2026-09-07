import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { geocode, reverseGeocode, fetchRoutes } from '../services/geo.js';
import { quoteAll } from '../services/fare.js';
import { suggestPlaces } from '../services/places.js';
import { surgeAt } from '../services/surge.js';
import { quotePromo, listPromos } from '../services/promos.js';

export const geoRouter = Router();

geoRouter.get('/pricing', (_req, res) => {
  res.json({ pricing: db.prepare('SELECT * FROM pricing ORDER BY sort_order').all() });
});

/** Offers the rider can tap instead of typing a code. */
geoRouter.get('/promos', requireAuth, (_req, res) => res.json({ promos: listPromos() }));

/**
 * GET /api/geo/suggest?q=   Instant suggestions: the user's recent places,
 * everyone's popular places and well-known landmarks, filtered by whatever has
 * been typed so far (works from zero characters).
 */
geoRouter.get('/suggest', requireAuth, (req, res) => {
  res.json({ results: suggestPlaces(req.user, String(req.query.q || '').trim()) });
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
 * POST /api/geo/routes  { waypoints: [{lat,lng}, ...], promo_code? }
 * Returns every route option with a fare quote per vehicle class, including any
 * demand surge at the pickup and the discount a promo code would give.
 * This is what powers "choose your own route": the customer sees the
 * alternatives (or their custom via-point route) with km + price for each.
 */
geoRouter.post('/routes', requireAuth, async (req, res, next) => {
  try {
    const { waypoints, promo_code } = req.body || {};
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
    const pickup = { lat: waypoints[0].lat, lng: waypoints[0].lng };

    // Surge depends on the vehicle class, so compute it per class once.
    const perType = {};
    for (const p of pricing) {
      const s = surgeAt(pickup, p.vehicle_type);
      perType[p.vehicle_type] = { surge: s.multiplier, surgeReason: s.reason };
    }

    // A promo is judged against the fare of the first route / selected class, but
    // reported per quote so the rider always sees the real post-discount price.
    let promo = null;
    const withQuotes = routes.map((r) => {
      const opts = {};
      for (const p of pricing) {
        const base = { ...perType[p.vehicle_type] };
        if (promo_code) {
          const undiscounted = quoteAll([p], r.distance_km, r.duration_min, { _all: base })[0].fare;
          const q = quotePromo(req.user, promo_code, undiscounted);
          if (q.ok) {
            base.discount = q.discount;
            base.promoCode = q.code;
          }
          if (!promo || (q.ok && !promo.ok)) promo = { ok: q.ok, code: q.code, description: q.description, reason: q.reason };
        }
        opts[p.vehicle_type] = base;
      }
      return { ...r, quotes: quoteAll(pricing, r.distance_km, r.duration_min, opts) };
    });

    res.json({
      routes: withQuotes,
      surge: perType,
      promo: promo_code ? promo : null,
    });
  } catch (e) {
    next(e);
  }
});
