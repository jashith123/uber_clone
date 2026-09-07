import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bool = (v, fallback = false) => (v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  dbPath: process.env.DB_PATH || path.join(here, '..', 'data', 'swiftride.db'),

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
  userAgent: 'SwiftRide/0.3 (local development)',

  uploadDir: process.env.UPLOAD_DIR || path.join(here, '..', 'data', 'uploads'),

  // ---- dispatch ----
  dispatch: {
    offerSeconds: Number(process.env.DISPATCH_OFFER_SECONDS || 20), // how long a driver has to accept
    radiiKm: (process.env.DISPATCH_RADII_KM || '3,6,10').split(',').map(Number), // wave 1, 2, 3 …
    driversPerWave: Number(process.env.DISPATCH_DRIVERS_PER_WAVE || 3),
    maxWaves: Number(process.env.DISPATCH_MAX_WAVES || 3),
  },

  // ---- payments ----
  // With no keys the built-in mock gateway is used: top-ups succeed instantly so
  // the whole wallet flow can be tested without any paid account.
  payments: {
    provider: process.env.PAYMENT_PROVIDER || 'mock', // mock | razorpay
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    commissionPercent: Number(process.env.COMMISSION_PERCENT || 15), // platform's cut of each fare
  },

  // ---- web push (free; keys are generated locally, see npm run push:keys) ----
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@swiftride.local',
  },

  // Off by default so the demo works out of the box; turn on to make new drivers
  // wait for admin approval before they can go online.
  requireDriverApproval: bool(process.env.REQUIRE_DRIVER_APPROVAL, false),
  adminEmails: (process.env.ADMIN_EMAILS || 'admin@demo.com').split(',').map((s) => s.trim().toLowerCase()),
};
