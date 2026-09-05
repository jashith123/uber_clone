import http from 'node:http';
import { config } from './config.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

if (process.env.SEED_DEMO === '1') {
  await import('./seed.js');
}

const app = createApp();
const server = http.createServer(app);
attachRealtime(server);
server.listen(config.port, '0.0.0.0', () => {
  console.log(`SwiftRide API listening on http://localhost:${config.port}`);
});
