import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { resumePendingDispatch } from './services/dispatch.js';
import { pushEnabled } from './services/push.js';
import { db } from './db.js';

// Seed when asked to, and also automatically when the database is empty. That
// second case matters on hosts with a fresh disk: without it the deployed app
// would come up with no accounts at all and no obvious way in.
const isEmpty = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
if (process.env.SEED_DEMO === '1' || isEmpty) {
  if (isEmpty) console.log('No accounts found, creating the demo accounts.');
  await import('./seed.js');
}

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
});
