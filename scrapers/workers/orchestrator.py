"""Orchestratore Python — polling scraper multipli.

Run: `python -m scrapers.workers.orchestrator`
PM2: `oddsradar-scraper`.
"""
import signal
import sys

import structlog
from apscheduler.schedulers.blocking import BlockingScheduler

from ..common.queue import push_run_log, push_snapshot
from ..sources import (
    betcity,
    melbet,
    mozzart,
    oddsportal,
    onexbet,
    polymarket,
    soccerbet,
    sportybet,
    superbet,
)

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


def job_1xbet_live() -> None:
    _run_source("1xbet_live", onexbet.fetch_live)


def job_betcity_live() -> None:
    _run_source("betcity_live", betcity.fetch_live)


def job_polymarket() -> None:
    _run_source("polymarket", polymarket.fetch_prematch)


# Disabled (bloccati da Cloudflare / endpoint 404). Codice pronto per riuso con proxy.
def job_mozzart_live() -> None:
    _run_source("mozzart_live", mozzart.fetch_live)


def job_sportybet_live() -> None:
    _run_source("sportybet_live", sportybet.fetch_live)


def job_superbet_live() -> None:
    _run_source("superbet_live", superbet.fetch_live)


def job_melbet_live() -> None:
    _run_source("melbet_live", melbet.fetch_live)


def job_soccerbet_live() -> None:
    _run_source("soccerbet_live", soccerbet.fetch_live)


def job_oddsportal_prematch() -> None:
    _run_source("oddsportal_prematch", lambda: oddsportal.fetch_all())


def main() -> None:
    scheduler = BlockingScheduler(timezone="UTC")

    scheduler.add_job(job_1xbet_live, "interval", minutes=2, id="1xbet", max_instances=1, coalesce=True)
    # betcity.ru — Playwright DOM parsing, 134 eventi live confermati.
    scheduler.add_job(job_betcity_live, "interval", minutes=3, id="betcity", max_instances=1, coalesce=True)
    # Polymarket prediction market — prematch, utenti reali USDC. Ogni 5 min.
    scheduler.add_job(job_polymarket, "interval", minutes=5, id="polymarket", max_instances=1, coalesce=True)

    def shutdown(*_):
        log.info("orchestrator.shutdown")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("orchestrator.start")
    job_1xbet_live()
    job_betcity_live()
    job_polymarket()
    scheduler.start()


if __name__ == "__main__":
    main()
