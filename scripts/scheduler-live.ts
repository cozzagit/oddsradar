/**
 * Scheduler live: chiama ingest-live ogni LIVE_INTERVAL_SEC secondi.
 * Default: 600s (10 min). RapidAPI free plan tipico = 100 req/day.
 * Ogni run: 2 chiamate (/fixtures?live=all + /odds/live) → 288 call/giorno a 10min.
 * Se quota è stretta, alzare a 900-1200s.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const INTERVAL_MS = Number(process.env.LIVE_INTERVAL_SEC ?? '600') * 1000;
const SCRIPT = path.resolve(__dirname, 'ingest-live.ts');

let running = false;

function runOnce(): Promise<void> {
  if (running) {
    console.log(`[${new Date().toISOString()}] skip: previous live run still in progress`);
    return Promise.resolve();
  }
  running = true;
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', SCRIPT], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    proc.on('exit', (code) => {
      running = false;
      if (code !== 0) console.warn(`live ingest exit code ${code}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log(`[scheduler-live] starting, interval ${INTERVAL_MS / 1000}s`);
  await runOnce();
  setInterval(() => void runOnce(), INTERVAL_MS);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

void main();
