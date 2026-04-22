/**
 * Scheduler divergence — gira ogni DIV_INTERVAL_SEC (default 180s = 3 min).
 * Esegue ingest-scrape-live.ts che legge le quote fresche dal DB e cerca
 * outlier/unilateral/cluster.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const INTERVAL_MS = Number(process.env.DIV_INTERVAL_SEC ?? '180') * 1000;
const SCRIPT = path.resolve(__dirname, 'ingest-scrape-live.ts');

let running = false;
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', SCRIPT], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    proc.on('exit', () => { running = false; resolve(); });
  });
}

async function main() {
  console.log(`[scheduler-divergence] interval ${INTERVAL_MS / 1000}s`);
  await runOnce();
  setInterval(() => void runOnce(), INTERVAL_MS);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
void main();
