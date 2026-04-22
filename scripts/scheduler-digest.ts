/**
 * Scheduler digest: esegue send-digest.ts allineato su :00 e :30.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, 'send-digest.ts');
let running = false;

function runOnce(): Promise<void> {
  if (running) return Promise.resolve();
  running = true;
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', SCRIPT], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    proc.on('exit', () => {
      running = false;
      resolve();
    });
  });
}

function msUntilNext30min(): number {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  const curMinute = now.getMinutes();
  if (curMinute < 30) next.setMinutes(30);
  else {
    next.setHours(now.getHours() + 1);
    next.setMinutes(0);
  }
  return next.getTime() - now.getTime();
}

async function tick(): Promise<void> {
  await runOnce();
  const ms = msUntilNext30min();
  const next = new Date(Date.now() + ms);
  console.log(`[digest] next run at ${next.toISOString()} (in ${Math.round(ms / 1000)}s)`);
  setTimeout(tick, ms);
}

async function main(): Promise<void> {
  const ms = msUntilNext30min();
  const next = new Date(Date.now() + ms);
  console.log(`[digest] boot, first run at ${next.toISOString()} (in ${Math.round(ms / 1000)}s)`);
  setTimeout(tick, ms);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
void main();
