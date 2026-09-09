/**
 * One-command start.
 *
 * Checks dependencies, builds the web app if needed, starts the server, and
 * prints exactly what to type on a phone. Run it with `npm start` or by
 * double-clicking start.bat on Windows.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 4000;

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m',
};

const say = (s = '') => console.log(s);
const step = (s) => say(`${c.dim}·${c.reset} ${s}`);
const ok = (s) => say(`${c.green}✓${c.reset} ${s}`);
const warn = (s) => say(`${c.yellow}!${c.reset} ${s}`);

/**
 * The address other devices on this network can reach.
 *
 * Reading the adapter list is unreliable: virtual adapters from VirtualBox,
 * VMware, WSL and Docker look identical to a real one and are often named
 * plainly ("Ethernet 2"). So ask the operating system instead which local
 * address it would use to reach the internet. No packet is actually sent;
 * connecting a UDP socket only sets the route.
 */
function routableAddress() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const sock = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      try { sock.close(); } catch { /* already closed */ }
      finish(null);
    }, 1000);
    sock.on('error', () => {
      clearTimeout(timer);
      try { sock.close(); } catch { /* already closed */ }
      finish(null);
    });
    try {
      sock.connect(53, '8.8.8.8', () => {
        clearTimeout(timer);
        const addr = sock.address().address;
        try { sock.close(); } catch { /* already closed */ }
        finish(addr && addr !== '0.0.0.0' ? addr : null);
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/** Fallback if there is no internet: guess from the adapter list. */
function guessFromAdapters() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(vEthernet|VirtualBox|VMware|Loopback|Bluetooth|WSL|Hyper-V)/i.test(name)) continue;
      if (/^192\.168\.56\./.test(a.address)) continue;  // VirtualBox host-only default
      if (/^169\.254\./.test(a.address)) continue;       // no DHCP answer
      candidates.push({ name, address: a.address });
    }
  }
  const wifi = candidates.find((x) => /wi-?fi|wlan|wireless/i.test(x.name));
  const home = candidates.find((x) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address));
  return (wifi || home || candidates[0])?.address || null;
}

async function lanAddress() {
  return (await routableAddress()) || guessFromAdapters();
}

/**
 * Is something already listening on our port, and is it us?
 * Auto-start means the server is often already running in the background, so
 * double-clicking start.bat must report that calmly rather than crashing.
 */
async function whatIsOnThePort() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body?.ok) return 'swiftride';
    }
    return 'other';
  } catch (e) {
    // Connection refused means the port is free. Anything else (a timeout, a
    // non-HTTP service) means something is there but it is not us.
    const code = e?.cause?.code || e?.code;
    if (code === 'ECONNREFUSED') return 'free';
    return e.name === 'TimeoutError' ? 'other' : 'free';
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) {
    say(`${c.red}Failed:${c.reset} ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

// ---------------------------------------------------------------- checks ----
say();
say(`${c.bold}Starting SwiftRide${c.reset}`);
say();

const needInstall = !existsSync(path.join(root, 'node_modules')) ||
  !existsSync(path.join(root, 'server', 'node_modules')) ||
  !existsSync(path.join(root, 'client', 'node_modules'));

if (needInstall) {
  step('First run: installing dependencies. This takes a minute or two…');
  run('npm', ['run', 'install:all']);
  ok('Dependencies installed');
}

const dist = path.join(root, 'client', 'dist');
const needBuild = !existsSync(dist) || readdirSync(dist).length === 0 || process.argv.includes('--build');
if (needBuild) {
  step('Building the web app…');
  run('npm', ['run', 'build']);
  ok('Web app built');
}

let printed = false;
// Declared as a function, not a const arrow, so the port check above can call it.
function banner(already = false) {
  if (printed) return;
  printed = true;
  say();
  say(`${c.green}${c.bold}  SwiftRide is ${already ? 'already running' : 'running'}${c.reset}`);
  say();
  say(`  ${c.bold}On this laptop${c.reset}`);
  say(`     ${c.cyan}http://localhost:${PORT}${c.reset}`);
  say();
  if (ip) {
    say(`  ${c.bold}On your phone${c.reset} ${c.dim}(same Wi-Fi as this laptop)${c.reset}`);
    say(`     ${c.cyan}${c.bold}http://${ip}:${PORT}${c.reset}`);
    say();
    say(`  ${c.bold}In the Android app${c.reset}, put this in the "Server address" box:`);
    say(`     ${c.cyan}http://${ip}:${PORT}${c.reset}`);
  } else {
    warn('No Wi-Fi address found. Connect this laptop to Wi-Fi, then restart.');
  }
  say();
  say(`  ${c.dim}Log in with customer@demo.com or driver@demo.com, password: password${c.reset}`);
  say(`  ${c.dim}Admin panel: admin@demo.com, then open /admin${c.reset}`);
  say();
  if (already) {
    say(`  ${c.dim}It was started in the background, most likely by auto-start.${c.reset}`);
    say(`  ${c.dim}You can close this window; the server keeps running.${c.reset}`);
    say(`  ${c.dim}To stop it: npm run stop  (or double-click stop.bat)${c.reset}`);
  } else {
    say(`  ${c.dim}Leave this window open. Close it, or press Ctrl+C, to stop.${c.reset}`);
  }
  say();
}

// ----------------------------------------------------------------- start ----
const ip = await lanAddress();

const occupant = await whatIsOnThePort();
if (occupant === 'swiftride') {
  banner(true);
  process.exit(3); // 3 = already running; start.bat pauses on this so it can be read
}
if (occupant === 'other') {
  say();
  say(`${c.yellow}  Port ${PORT} is already being used by another program.${c.reset}`);
  say();
  say(`  SwiftRide needs that port. Either close the other program, or free the`);
  say(`  port with:   ${c.cyan}npm run stop${c.reset}`);
  say();
  say(`  ${c.dim}To use a different port instead:  set PORT=4100 && npm start${c.reset}`);
  say();
  process.exit(1);
}

const child = spawn('node', ['--env-file-if-exists=.env', '--no-warnings=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(root, 'server'),
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (d) => {
  const text = d.toString();
  process.stdout.write(`${c.dim}${text}${c.reset}`);
  if (text.includes('listening on')) setTimeout(banner, 150);
});
child.stderr.on('data', (d) => {
  const text = d.toString();
  if (text.includes('EADDRINUSE')) {
    // Something grabbed the port between the check above and this spawn.
    say();
    say(`${c.yellow}  Port ${PORT} was taken just now. SwiftRide is probably already running.${c.reset}`);
    say(`  ${c.dim}Open http://localhost:${PORT} to check, or run: npm run stop${c.reset}`);
    say();
    return;
  }
  process.stderr.write(text);
});

child.on('exit', (code) => {
  say();
  if (code === 0 || code === null) say('SwiftRide stopped.');
  else if (!printed) say(`${c.red}SwiftRide could not start (code ${code}). The message above says why.${c.reset}`);
  else say(`${c.red}SwiftRide stopped unexpectedly (code ${code}).${c.reset}`);
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill();
    process.exit(0);
  });
}
