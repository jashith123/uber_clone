import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { resumePendingDispatch } from './services/dispatch.js';
import { pushEnabled } from './services/push.js';
import { getWallet } from './services/payments.js';
import { hashPassword } from './auth.js';
import { db } from './db.js';

// Nothing in the app should take the process down on its own: log it and carry on.
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));

// ----------------------------------------------------------------- seed ----
// An empty database gets the demo accounts (SEED_DEMO=0 to skip them) and,
// failing that, at least one admin so there is always a way in. On hosts
// with no permanent disk this runs again after every restart.
const isEmpty = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
if (process.env.SEED_DEMO === '1' || (isEmpty && config.seedDemo)) {
  if (isEmpty) console.log('No accounts found, creating the demo accounts.');
  await import('./seed.js');
} else if (isEmpty) {
  const email = config.adminEmails[0];
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const r = db
    .prepare('INSERT INTO users (role, name, email, phone, password_hash, is_admin) VALUES (?,?,?,?,?,1)')
    .run('customer', 'Admin', email, null, hashPassword(password));
  getWallet(Number(r.lastInsertRowid));
  console.log(`No accounts found. Created admin ${email} with password: ${password}`);
  if (!process.env.ADMIN_PASSWORD) console.log('  (generated once; set ADMIN_PASSWORD to choose your own)');
}

// ---------------------------------------------------------------- start ----
const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, '0.0.0.0', () => {
  const resumed = resumePendingDispatch();
  console.log(`SwiftRide API listening on http://localhost:${config.port}`);
  console.log(
    `  payments: ${config.payments.provider}${config.payments.provider === 'mock' ? ' (test mode, no real money)' : ''}` +
      ` · push: ${pushEnabled() ? 'on' : 'off (set VAPID keys)'}` +
      ` · driver approval: ${config.requireDriverApproval ? 'required' : 'automatic'}`,
  );
  if (resumed) console.log(`  resumed dispatch for ${resumed} ride(s)`);

  if (config.isProduction) {
    if (!config.jwtSecretFromEnv) console.log('  sessions: JWT_SECRET not set, using the generated one stored next to the database');
    if (config.seedDemo && config.demoPassword === 'password') {
      console.warn('  WARNING: demo accounts use the default password. Set DEMO_PASSWORD (and ADMIN_PASSWORD) before sharing this address.');
    }
  }
});

// ------------------------------------------------------------- shutdown ----
// Hosts send SIGTERM on redeploy; finish in-flight requests, then let go.
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down…`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));
