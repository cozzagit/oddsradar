"""Orchestratore Python — poll periodico di fonti HTML.

Run: `python -m scrapers.workers.orchestrator`
PM2: processo `oddsradar-scraper`.
"""
import signal
import sys

import structlog
from apscheduler.schedulers.blocking import BlockingScheduler

from ..common.queue import push_run_log, push_snapshot
from ..sources import oddsportal, the_odds_api

log = structlog.get_logger()


def job_oddsportal() -> None:
    try:
        snapshots = oddsportal.fetch_all()
        for s in snapshots:
            push_snapshot(s)
        push_run_log("oddsportal", len(snapshots), 0, "success")
        log.info("job.oddsportal.done", snapshots=len(snapshots))
    except Exception as exc:  # noqa: BLE001
        log.exception("job.oddsportal.failed", error=str(exc))
        push_run_log("oddsportal", 0, 1, "failed")


def main() -> None:
    scheduler = BlockingScheduler(timezone="UTC")
    # OddsPortal: ogni 10 min (polite)
    scheduler.add_job(job_oddsportal, "interval", minutes=10, id="oddsportal", max_instances=1, next_run_time=None)

    def shutdown(*_):
        log.info("orchestrator.shutdown")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("orchestrator.start")
    # kickstart immediato
    job_oddsportal()
    scheduler.start()


if __name__ == "__main__":
    main()
