import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { geoRouter } from './routes/geo.js';
import { ridesRouter } from './routes/rides.js';
import { driversRouter } from './routes/drivers.js';
import { nearbyDrivers } from './realtime.js';
import { requireAuth } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/geo', geoRouter);
  app.use('/api/rides', ridesRouter);

  // Any signed-in user (customers use it for the "cars nearby" layer). Must be
  // mounted BEFORE the driver-only router below.
  app.get('/api/drivers/nearby', requireAuth, (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat and lng required' });
    res.json({ drivers: nearbyDrivers(lat, lng, req.query.vehicle_type) });
  });
  app.use('/api/drivers', driversRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

  // Production: serve the built web app from the same origin as the API, so one
  // port (and one tunnel URL) carries the site, the API and the socket.
  const distDir = path.resolve(here, '..', '..', 'client', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });
  return app;
}
