/**
 * Builds the web bundle for the native app with the API address baked in.
 * Usage: node scripts/build-android.mjs [http://your-pc-ip:4000]
 * Default: SWIFTRIDE_API_URL env var, else http://192.168.29.217:4000
 */
import { execSync } from 'node:child_process';
const url = process.argv[2] || process.env.SWIFTRIDE_API_URL || 'http://192.168.29.217:4000';
console.log(`Building native web bundle with API at ${url}`);
execSync('npx tsc -b && npx vite build', { stdio: 'inherit', env: { ...process.env, VITE_API_URL: url } });
