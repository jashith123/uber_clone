import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';
import { resumePendingDispatch } from './services/dispatch.js';
import { pushEnabled } from './services/push.js';

if (process.env.SEED_DEMO === '1') {
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
