"""Orchestratore Python — polling scraper multipli.

Run: `python -m scrapers.workers.orchestrator`
PM2: `oddsradar-scraper`.
"""
import signal
import sys

import structlog
from apscheduler.schedulers.blocking import BlockingScheduler

from ..common.queue import push_run_log, push_snapshot
from ..sources import oddsportal, mozzart, sportybet, superbet, onexbet, melbet, soccerbet

log = structlog.get_logger()


def _run_source(name: str, fetch_fn) -> None:
    try:
        snapshots = fetch_fn()
        for s in snapshots:
            push_snapshot(s)
        push_run_log(name, len(snapshots), 0, "success")
        log.info("job.done", source=name, snapshots=len(snapshots))
    except Exception as exc:  # noqa: BLE001
        log.exception("job.failed", source=name, error=str(exc))
        push_run_log(name, 0, 1, "failed")


def job_mozzart_live() -> None:
    _run_source("mozzart_live", mozzart.fetch_live)


def job_sportybet_live() -> None:
    _run_source("sportybet_live", sportybet.fetch_live)


def job_superbet_live() -> None:
    _run_source("superbet_live", superbet.fetch_live)


def job_1xbet_live() -> None:
    _run_source("1xbet_live", onexbet.fetch_live)


def job_melbet_live() -> None:
    _run_source("melbet_live", melbet.fetch_live)


def job_soccerbet_live() -> None:
    _run_source("soccerbet_live", soccerbet.fetch_live)


def job_oddsportal_prematch() -> None:
    _run_source("oddsportal_prematch", lambda: oddsportal.fetch_all())


def main() -> None:
    scheduler = BlockingScheduler(timezone="UTC")

    # Solo 1xbet (via 1xstavka.ru) conferma funzionante dal VPS senza proxy.
    # Gli altri tre (Mozzart/SportyBet/SuperBet) sono bloccati da Cloudflare;
    # tenuti disabled ma codice pronto per quando avremo proxy residenziali.
    scheduler.add_job(job_1xbet_live, "interval", minutes=2, id="1xbet", max_instances=1, coalesce=True)
    # melbet Playwright: CF re-challenge sull'API anche dopo bypass landing. Disabled
    # finché non riscritto per parsare il DOM live (invece di chiamare /service-api/).
    # scheduler.add_job(job_melbet_live, "interval", minutes=3, id="melbet", max_instances=1, coaleske=True)
    # soccerbet: path /restapi/ tornano 404. Serve re-scoperta endpoint. Disabled.
    # scheduler.add_job(job_soccerbet_live, "interval", minutes=2, id="soccerbet", max_instances=1, coalesce=True)

    # OddsPortal prematch: anch'esso rende 0 eventi al momento, lo lascio
    # disabled finché non calibriamo i selettori. Commentato per non sporcare log.
    # scheduler.add_job(job_oddsportal_prematch, "interval", minutes=15, id="oddsportal", max_instances=1)

    def shutdown(*_):
        log.info("orchestrator.shutdown")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("orchestrator.start")
    job_1xbet_live()
    scheduler.start()


if __name__ == "__main__":
    main()
