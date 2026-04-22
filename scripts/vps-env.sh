#!/bin/bash
set -e
cat > /var/www/oddsradar/.env <<EOF
DATABASE_URL=postgresql://oddsradar:OddsRadar_2026_V9x@localhost:5432/oddsradar
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_TRUST_HOST=true
NEXTAUTH_URL=https://oddsradar.vibecanyon.com
ALLOWED_EMAILS=luca.cozza@gmail.com
REDIS_URL=redis://127.0.0.1:6379
THE_ODDS_API_KEY=4b62849012304b9c8baa0fc780646ad5
BETFAIR_APP_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
RESEND_API_KEY=
PROXY_PROVIDER=none
VALUE_EDGE_MIN=0.03
STEAM_WINDOW_MIN=5
STEAM_MOVE_PCT=8
ARB_EDGE_MIN=0.005
NODE_ENV=production
PORT=3041
EOF
chmod 600 /var/www/oddsradar/.env
echo "env written"
