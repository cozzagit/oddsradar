import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';

const INTERVAL_MS = Number(process.env.KILLSWITCH_INTERVAL_SEC ?? '3600') * 1000; // 1h
const SCRIPT = path.resolve(__dirname, 'auto-disable-kinds.ts');
let running = false;

function runOnce(): Promise<void> {
  if (running) return Promise.resolve();
  running = true;
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', SCRIPT], {
      stdio: 'inherit', shell: process.platform === 'win32', env: process.env,
    });
    proc.on('exit', () => { running = false; resolve(); });
  });
}

async function main() {
  console.log(`[killswitch] interval ${INTERVAL_MS / 1000}s`);
  await runOnce();
  setInterval(() => void runOnce(), INTERVAL_MS);
}
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
void main();
