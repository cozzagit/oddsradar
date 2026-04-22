/**
 * Long-running scheduler. Runs ingest:now ogni INGEST_INTERVAL_SEC secondi
 * (default 300s = 5 min). Gestito come processo PM2.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const INTERVAL_MS = Number(process.env.INGEST_INTERVAL_SEC ?? '300') * 1000;
const SCRIPT = path.resolve(__dirname, 'ingest-now.ts');

let running = false;

async function runOnce(): Promise<void> {
  if (running) {
    console.log(`[${new Date().toISOString()}] skip: previous run still in progress`);
    return;
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
      if (code !== 0) console.warn(`ingest exited with code ${code}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log(`[scheduler] starting, interval ${INTERVAL_MS / 1000}s`);
  await runOnce();
  setInterval(() => {
    void runOnce();
  }, INTERVAL_MS);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

void main();
