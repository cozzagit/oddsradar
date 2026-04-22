#!/bin/bash
set -e
cd /var/www/oddsradar

echo "=== pull ==="
git pull --ff-only

echo "=== npm install ==="
npm install

echo "=== build ==="
rm -rf .next
npm run build

echo "=== python venv ==="
if [ ! -d scrapers/.venv ]; then
  python3 -m venv scrapers/.venv
fi
scrapers/.venv/bin/pip install --upgrade pip setuptools wheel
scrapers/.venv/bin/pip install -r scrapers/requirements.txt

echo "=== PM2 (start scheduler + scraper + drain, restart web) ==="
pm2 delete oddsradar-scheduler || true
pm2 delete oddsradar-scraper || true
pm2 delete oddsradar-drain || true

pm2 start ecosystem.config.js
pm2 save

pm2 list | grep oddsradar
echo "=== DONE ==="
