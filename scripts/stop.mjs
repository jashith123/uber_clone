/** Stops whatever is listening on the SwiftRide port. */
import { execSync } from 'node:child_process';

const PORT = process.env.PORT || 4000;
let stopped = 0;

try {
  if (process.platform === 'win32') {
    const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
    const pids = new Set(
      out
        .split('\n')
        .filter((l) => l.includes(`:${PORT}`) && l.includes('LISTENING'))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p) => p && p !== '0'),
    );
    for (const pid of pids) {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      stopped += 1;
    }
  } else {
    const out = execSync(`lsof -ti tcp:${PORT}`, { encoding: 'utf8' }).trim();
    for (const pid of out.split('\n').filter(Boolean)) {
      execSync(`kill -9 ${pid}`);
      stopped += 1;
    }
  }
} catch {
  /* nothing was listening */
}

console.log(stopped ? `Stopped SwiftRide (${stopped} process).` : `Nothing was running on port ${PORT}.`);
