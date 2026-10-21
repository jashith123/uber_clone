/**
 * One command for the phone app:
 *
 *   npm run apk                       bakes this PC's Wi-Fi address into the app
 *   npm run apk -- http://host:4000   or a tunnel / hosted address
 *
 * Builds the web bundle for the native shell, syncs it into the Android
 * project, runs the signed release build, and leaves exactly one file in
 * final-apk/ (the previous build is deleted). Needs Android Studio's bundled
 * JDK and the Android SDK, which `npx cap open android` sets up the first time.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'final-apk');
const built = path.join(root, 'client', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

function lanAddress() {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const t = setTimeout(() => { try { s.close(); } catch { /* closed */ } resolve(null); }, 1000);
    s.on('error', () => { clearTimeout(t); resolve(null); });
    try {
      s.connect(53, '8.8.8.8', () => { clearTimeout(t); const a = s.address().address; try { s.close(); } catch { /* closed */ } resolve(a && a !== '0.0.0.0' ? a : null); });
    } catch { clearTimeout(t); resolve(null); }
  });
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) { console.error(`\nFailed: ${cmd} ${args.join(' ')}`); process.exit(r.status ?? 1); }
}

const url = process.argv[2] || process.env.SWIFTRIDE_API_URL || `http://${(await lanAddress()) || '192.168.1.9'}:${process.env.PORT || 4000}`;
console.log(`\nBuilding the Android app with the server at ${url}\n`);

// Android Studio's JDK, unless one is already set.
const env = { ...process.env, SWIFTRIDE_API_URL: url };
if (!env.JAVA_HOME) {
  for (const jdk of ['C:\\Program Files\\Android\\Android Studio\\jbr', '/Applications/Android Studio.app/Contents/jbr/Contents/Home']) {
    if (existsSync(jdk)) { env.JAVA_HOME = jdk; env.PATH = `${path.join(jdk, 'bin')}${path.delimiter}${env.PATH}`; break; }
  }
}

run('node', ['scripts/build-android.mjs', url], { cwd: path.join(root, 'client'), env });
run('npx', ['cap', 'sync', 'android'], { cwd: path.join(root, 'client'), env });
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleRelease', '--no-daemon', '-q'], { cwd: path.join(root, 'client', 'android'), env });

if (!existsSync(built)) { console.error('The build finished but no APK was produced.'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) rmSync(path.join(outDir, f), { force: true }); // only ever one file here
const target = path.join(outDir, 'SwiftRide-release.apk');
copyFileSync(built, target);
console.log(`\nDone: ${target} (${(statSync(target).size / 1024 / 1024).toFixed(2)} MB)`);
console.log('Copy it to each phone (WhatsApp to yourself, USB or Drive) and install it.');
