// PM2 ecosystem — deploy su VPS Aruba.
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'oddsradar-web',
      cwd: '/var/www/oddsradar',
      script: 'node_modules/.bin/next',
      args: 'start --port 3041',
      env: { NODE_ENV: 'production', PORT: '3041' },
      autorestart: true,
      max_memory_restart: '600M',
    },
    {
      name: 'oddsradar-scheduler',
      cwd: '/var/www/oddsradar',
      script: 'node_modules/.bin/tsx',
      args: 'scripts/scheduler.ts',
      env: { NODE_ENV: 'production', INGEST_INTERVAL_SEC: '300' },
      autorestart: true,
      max_memory_restart: '400M',
      kill_timeout: 10000,
    },
    {
      name: 'oddsradar-live',
      cwd: '/var/www/oddsradar',
      script: 'node_modules/.bin/tsx',
      args: 'scripts/scheduler-live.ts',
      env: { NODE_ENV: 'production', LIVE_INTERVAL_SEC: '600' },
      autorestart: true,
      max_memory_restart: '400M',
      kill_timeout: 10000,
    },
    {
      name: 'oddsradar-scraper',
      cwd: '/var/www/oddsradar',
      script: 'scrapers/.venv/bin/python',
      args: '-m scrapers.workers.orchestrator',
      autorestart: true,
      max_memory_restart: '500M',
      restart_delay: 5000,
    },
    {
      name: 'oddsradar-drain',
      cwd: '/var/www/oddsradar',
      script: 'node_modules/.bin/tsx',
      args: 'scripts/drain-scrape-queue.ts',
      autorestart: true,
      max_memory_restart: '400M',
    },
  ],
};
