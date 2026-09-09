/**
 * Makes SwiftRide start by itself every time Windows starts.
 *
 *   node scripts/autostart.mjs on     turn it on
 *   node scripts/autostart.mjs off    turn it off
 *   node scripts/autostart.mjs        show whether it is on
 *
 * It works by putting a shortcut in the Startup folder, which needs no admin
 * rights and is easy to undo by hand (Win+R, type shell:startup).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbsPath = path.join(startupDir, 'SwiftRide.vbs');
const action = (process.argv[2] || 'status').toLowerCase();

if (process.platform !== 'win32') {
  console.log('This helper is for Windows. On Linux or a Mac, use a systemd service or pm2 instead.');
  process.exit(0);
}

// A .vbs launcher rather than a .bat, so no console window flashes on login.
const vbs = `' Starts SwiftRide quietly when Windows starts. Delete this file to stop that.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "${root.replace(/\\/g, '\\\\')}"
shell.Run "cmd /c node scripts\\start.mjs > logs\\server.log 2>&1", 0, False
`;

function on() {
  fs.mkdirSync(startupDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(vbsPath, vbs, 'utf8');
  console.log('Auto-start is ON.');
  console.log('  SwiftRide will now start by itself every time you log in to Windows.');
  console.log('  It runs in the background with no window.');
  console.log(`  Its messages go to: ${path.join(root, 'logs', 'server.log')}`);
  console.log(`  To turn it off:  node scripts/autostart.mjs off`);
}

function off() {
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    console.log('Auto-start is OFF. SwiftRide will no longer start on its own.');
  } else {
    console.log('Auto-start was already off.');
  }
}

function status() {
  const isOn = fs.existsSync(vbsPath);
  console.log(isOn ? 'Auto-start is ON.' : 'Auto-start is OFF.');
  console.log(`  Turn it ${isOn ? 'off' : 'on'}:  node scripts/autostart.mjs ${isOn ? 'off' : 'on'}`);
}

/** Start it right now as well, so the user does not have to reboot to see it work. */
function startNow() {
  try {
    execFileSync('cscript', ['//nologo', vbsPath], { cwd: root, stdio: 'ignore', timeout: 5000 });
  } catch {
    /* the shortcut still works at next login */
  }
}

if (action === 'on') {
  on();
  startNow();
} else if (action === 'off') {
  off();
} else {
  status();
}
