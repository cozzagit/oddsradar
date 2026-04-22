"""Orchestratore degli scraper — APScheduler con job per fonte.

Run: `python -m scrapers.workers.orchestrator`
Produzione: processo PM2 dedicato (vedi ecosystem.config.js).
"""
import signal
import sys

import structlog
from apscheduler.schedulers.blocking import BlockingScheduler

from ..common.queue import push_run_log, push_snapshot
from ..sources import the_odds_api

log = structlog.get_logger()

SOCCER_SPORTS = [
    "soccer_italy_serie_a",
    "soccer_italy_serie_b",
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
    "soccer_uefa_champs_league",
    "soccer_uefa_europa_league",
]


def job_the_odds_api() -> None:
    total = 0
    errors = 0
    for sport_key in SOCCER_SPORTS:
        try:
            snapshots = the_odds_api.fetch_sport(sport_key)
            for s in snapshots:
                push_snapshot(s)
            total += len(snapshots)
        except Exception as exc:
            errors += 1
            log.error("ingest.the_odds_api.failed", sport=sport_key, error=str(exc))
    push_run_log("the_odds_api", total, errors, "success" if errors == 0 else "partial")
    log.info("ingest.the_odds_api.done", fetched=total, errors=errors)


def main() -> None:
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(job_the_odds_api, "interval", minutes=5, id="the_odds_api", max_instances=1)

    def shutdown(*_):
        log.info("orchestrator.shutdown")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("orchestrator.start")
    scheduler.start()


if __name__ == "__main__":
    main()
