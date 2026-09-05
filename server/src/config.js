import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  dbPath: process.env.DB_PATH || path.join(here, '..', 'data', 'swiftride.db'),
  // Comma-separated list of allowed browser origins (localhost and 127.0.0.1 are
  // both allowed by default so two different logins can be tested side by side).
  // https://localhost and capacitor://localhost are the origins of the native
  // Android / iOS apps built with Capacitor.
  clientOrigin: (
    process.env.CLIENT_ORIGIN ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4000,https://localhost,capacitor://localhost'
  )
    .split(',')
    .map((s) => s.trim()),
  osrmUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  userAgent: 'SwiftRide/0.1 (local development)',
};
