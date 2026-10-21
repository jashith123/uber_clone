import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bool = (v, fallback = false) => (v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

const isProduction = process.env.NODE_ENV === 'production';
const dbPath = process.env.DB_PATH || path.join(here, '..', 'data', 'swiftride.db');

/**
 * The secret that signs sessions. Set JWT_SECRET in production. When it is
 * missing, a random one is generated once and kept next to the database, so a
 * Docker or Fly deployment without the variable still gets a strong secret and
 * sessions survive restarts. In-memory databases (tests) get a throwaway one.
 */
function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (dbPath === ':memory:') return 'test-secret';
  const file = path.join(path.dirname(dbPath), 'jwt-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved) return saved;
  } catch {
    /* first run */
  }
  const fresh = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}

// Origins of the native Android / iOS apps built with Capacitor. Always allowed,
// so setting CLIENT_ORIGIN for a website never locks the phone app out. The
// website itself is served by this server, so it needs no entry at all.
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4000'];

export const config = {
  port: Number(process.env.PORT || 4000),
  isProduction,
  jwtSecret: jwtSecret(),
  jwtSecretFromEnv: Boolean(process.env.JWT_SECRET),
  dbPath,

  clientOrigin: [
    ...new Set([
      ...(process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
      ...NATIVE_ORIGINS,
      ...(isProduction ? [] : DEV_ORIGINS),
    ]),
  ],

  osrmUrl: process.env.OSRM_URL || 'https://router.project-osrm.org',
  nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  // Nominatim's usage policy asks for an identifying User-Agent with a contact.
  userAgent: process.env.USER_AGENT || `SwiftRide/0.3 (+${process.env.VAPID_SUBJECT || 'mailto:admin@swiftride.local'})`,

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
    commissionPercent: Number(process.env.COMMISSION_PERCENT || 10), // platform's cut of each fare; the rest is the driver's
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

  // "I've arrived" only counts within this distance of the pickup, judged from
  // the driver's last reported position, which must be no older than this.
  arrivalRadiusKm: Number(process.env.ARRIVAL_RADIUS_KM || 1),
  locationMaxAgeMin: Number(process.env.LOCATION_MAX_AGE_MIN || 10),

  // In-app calls. STUN finds a direct path; a TURN relay is needed when the two
  // phones are on different networks (mobile data). Open Relay is a free public
  // relay for demos; point TURN_URLS at your own server for production, or set
  // TURN_URLS to an empty string to use STUN only.
  ice: {
    stun: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
    turnUrls: (process.env.TURN_URLS ?? 'turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turn:openrelay.metered.ca:443?transport=tcp')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnUsername: process.env.TURN_USERNAME ?? 'openrelayproject',
    turnCredential: process.env.TURN_CREDENTIAL ?? 'openrelayproject',
  },

  // Demo accounts: created on an empty database unless SEED_DEMO=0. Set
  // DEMO_PASSWORD (and ADMIN_PASSWORD) on a public server; the login page
  // stops printing the password as soon as it is no longer the default.
  seedDemo: bool(process.env.SEED_DEMO, true),
  demoPassword: process.env.DEMO_PASSWORD || 'password',
  adminPassword: process.env.ADMIN_PASSWORD || process.env.DEMO_PASSWORD || 'password',
  adminEmails: (process.env.ADMIN_EMAILS || 'admin@demo.com,owner@demo.com').split(',').map((s) => s.trim().toLowerCase()),
  // The owner sees the company's books: cash held, profit, every account and
  // wallet, and pays drivers out. Owners are admins too.
  ownerEmails: (process.env.OWNER_EMAILS || 'owner@demo.com').split(',').map((s) => s.trim().toLowerCase()),
  company: {
    name: process.env.COMPANY_NAME || 'SwiftRide',
    // The UPI ID behind the company QR that riders pay at the end of a cash ride.
    upiId: process.env.COMPANY_UPI_ID || 'swiftride@upi',
  },
};
