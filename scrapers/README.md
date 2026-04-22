# OddsRadar — Scrapers (Python)

Workers che popolano la coda Redis (`ingest`) con snapshot raw di quote.
Consumano fonti API e siti HTML; un worker Node downstream normalizza e persiste.

## Setup

```bash
cd scrapers
python -m venv .venv
source .venv/bin/activate  # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

## Struttura

```
scrapers/
├── common/           # client HTTP, redis, logger, proxy manager
├── sources/          # un file per bookmaker/aggregatore
│   ├── the_odds_api.py
│   ├── oddsportal.py
│   └── betfair_exchange.py
├── workers/          # entrypoint orchestrazione (scheduler per fonte)
└── requirements.txt
```

## Esecuzione

Ogni source espone una funzione `fetch(config) -> list[RawSnapshot]`.
`workers/orchestrator.py` gestisce lo scheduling (cron per fonte) e pubblica su Redis.
