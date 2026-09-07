/**
 * Generates the VAPID key pair used for web push notifications.
 * Free, offline, no account: run it once and paste the output into server/.env
 *   npm run push:keys
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, '..', '.env');
const keys = webpush.generateVAPIDKeys();

const lines = [`VAPID_PUBLIC_KEY=${keys.publicKey}`, `VAPID_PRIVATE_KEY=${keys.privateKey}`];

if (fs.existsSync(envPath) && /VAPID_PUBLIC_KEY=\S/.test(fs.readFileSync(envPath, 'utf8'))) {
  console.log('\nserver/.env already has push keys. Not overwriting. New pair, if you want to rotate:\n');
  console.log(lines.join('\n'));
  console.log('\nRotating invalidates every existing subscription.\n');
} else {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').replace(/VAPID_(PUBLIC|PRIVATE)_KEY=.*\n?/g, '') : '';
  fs.writeFileSync(envPath, `${existing.trimEnd()}\n\n# Web push (generated ${new Date().toISOString().slice(0, 10)})\n${lines.join('\n')}\nVAPID_SUBJECT=mailto:admin@swiftride.local\n`);
  console.log(`\nWrote push keys to ${envPath}`);
  console.log('Restart the server and notifications are on. Keep the private key secret.\n');
}
