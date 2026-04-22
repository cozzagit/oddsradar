# OddsRadar

Tool analitico personale per rilevare **arbitraggi, value bet e steam moves** aggregando quote da molti bookmaker internazionali (mainstream + minori: balcanici, asiatici, africani, LatAm) e volumi pubblici exchange (Betfair, Smarkets).

> Uso strettamente personale. Nessuna ridistribuzione delle quote raw. Niente scommesse piazzate dal tool.

## Stack

- **Next.js 16** (App Router, Turbopack) + TypeScript + Tailwind v4
- **Auth.js v5** (JWT, credentials, single-user whitelist via `ALLOWED_EMAILS`)
- **Drizzle ORM** + **PostgreSQL 16** (+ **TimescaleDB** opzionale per `odds_snapshots` hypertable)
- **BullMQ** + **Redis** per ingestion pipeline
- **Python 3.12** + Playwright + curl_cffi per scraper (sottosistema isolato)
- **SSE** per feed signals real-time

Deploy: VPS Aruba → `oddsradar.vibecanyon.com` (nginx + Let's Encrypt + PM2).

## Struttura

```
oddsradar/
├── src/
│   ├── app/
│   │   ├── (app)/              # rotte protette (signals, events, ingestion, settings)
│   │   ├── (auth)/login/       # login
│   │   └── api/                # signals, stream SSE, auth
│   └── lib/
│       ├── db/                 # Drizzle schema, client, seed
│       ├── auth/               # Auth.js config
│       ├── detectors/          # arbitrage, value-bet, (steam TODO)
│       ├── queue/              # BullMQ queues
│       └── utils/
├── scrapers/                   # Python workers
│   ├── common/                 # config, redis push, models
│   ├── sources/                # the_odds_api, oddsportal, betfair_exchange, ...
│   └── workers/orchestrator.py # APScheduler
├── drizzle/migrations/         # SQL extensions + timescaledb setup
├── proxy.ts                    # Next.js 16 proxy (ex middleware) — auth gate
├── ecosystem.config.js         # PM2 prod config
└── docs/                       # requirements, architecture, fonti (in C:\work\Cozza\docs\)
```

## Setup locale

### 1. Postgres
Crea DB e utente:
```sql
CREATE USER oddsradar WITH PASSWORD 'oddsradar';
CREATE DATABASE oddsradar OWNER oddsradar;
\c oddsradar
GRANT ALL ON SCHEMA public TO oddsradar;
```

### 2. Env
```bash
cp .env.example .env
# Genera AUTH_SECRET con: openssl rand -base64 32
# Aggiungi THE_ODDS_API_KEY da https://the-odds-api.com
```

### 3. Install
```bash
npm install
```

### 4. Schema DB
```bash
npm run db:push          # applica schema Drizzle
npm run db:ext           # abilita pg_trgm + trigram index
npm run db:timescale     # opzionale: TimescaleDB hypertable + continuous aggregate
npm run db:seed          # seed sports/markets/books
```

### 5. Crea utente
```bash
npm run hash:password -- luca.cozza@gmail.com <PASSWORD>
```

### 6. Scraper venv (Python)
```bash
cd scrapers
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 7. Run
```bash
# Terminal 1 — Next.js (porta 3040)
npm run dev

# Terminal 2 — Scraper orchestrator
cd scrapers && .venv/bin/python -m scrapers.workers.orchestrator

# Terminal 3 — Redis (se non già attivo)
redis-server
```

Apri http://localhost:3040 → login con l'email in `ALLOWED_EMAILS`.

## Deploy VPS

1. DNS A record: `oddsradar.vibecanyon.com → 188.213.170.214`
2. `git clone` in `/var/www/oddsradar` sul VPS
3. `npm install && npm run build`
4. `createdb oddsradar && npm run db:push && npm run db:seed`
5. Nginx config (vedi `docs/2026-04-22-oddsradar-architecture.md` §9) + `certbot --nginx -d oddsradar.vibecanyon.com`
6. `pm2 start ecosystem.config.js && pm2 save`

## Roadmap

- **v0.1 MVP** — ingestion TheOddsAPI + Betfair delayed + OddsPortal, detector arbitrage + value, dashboard signals, Telegram notify
- **v0.2** — Steam detector, CLV tracker, fonti aggiuntive (SBOBet via OddsPapi, 1xBet, Mozzart)
- **v1.0** — Bet log manuale, backtest Football-Data, soglie custom, export CSV

## Documenti di progetto

In `C:\work\Cozza\docs\`:
- `2026-04-22-oddsradar-requirements.md` — personas, user stories MoSCoW, KPI, acceptance MVP
- `2026-04-22-oddsradar-architecture.md` — ADR stack/DB/anti-bot/detection, schema, deploy
- `2026-04-22-oddsradar-fonti.md` — catalogo 60+ fonti scrapabili
