// PM2 ecosystem — deploy su VPS Aruba.
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'oddsradar-web',
      cwd: '/var/www/oddsradar',
      script: 'node_modules/.bin/next',
      args: 'start --port 3040',
      env: { NODE_ENV: 'production', PORT: '3040' },
      autorestart: true,
      max_memory_restart: '600M',
    },
    {
      name: 'oddsradar-scraper',
      cwd: '/var/www/oddsradar/scrapers',
      script: '.venv/bin/python',
      args: '-m scrapers.workers.orchestrator',
      autorestart: true,
      max_memory_restart: '500M',
    },
  ],
};
