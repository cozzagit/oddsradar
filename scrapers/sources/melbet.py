"""Melbet (.ng) — family 1xbet. Cloudflare blocca curl diretto.
Strategia: Playwright carica la landing e ottiene cookie validi (cf_clearance),
poi invoca l'API LiveFeed/GetGamesZip via fetch() dal browser stesso.
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

import structlog

from ..common.browser import fetch_json_with_browser, run_sync
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

HOST = "https://melbet.ng"
LANDING = f"{HOST}/en/live/football"


def _api_url() -> str:
    anti = int(time.time() * 1000)
    return f"{HOST}/service-api/LiveFeed/GetGamesZip?sports=1&count=80&lng=en&mode=4&antiCacheStamp={anti}"


def _parse_event(ev: dict) -> RawEventSnapshot | None:
    try:
        home = ev.get("O1") or ""
        away = ev.get("O2") or ""
        if not home or not away:
            return None
        league = ev.get("L") or "Unknown"
        ts = ev.get("S") or 0
        kickoff = (
            datetime.fromtimestamp(ts, tz=timezone.utc)
            if isinstance(ts, (int, float)) and ts > 0
            else datetime.now(timezone.utc)
        )
        events_list = ev.get("E") or []
        markets_out: list[RawMarketSnapshot] = []

        oh = od = oa = None
        for m in events_list:
            if m.get("G") == 1:
                t = m.get("T")
                c = m.get("C")
                try:
                    c = float(c)
                except (TypeError, ValueError):
                    continue
                if c < 1.01:
                    continue
                if t == 1:
                    oh = c
                elif t == 2:
                    od = c
                elif t == 3:
                    oa = c
        if oh and od and oa:
            markets_out.append(
                RawMarketSnapshot(
                    market_name="h2h",
                    selections=[
                        RawSelectionOdd(selection_name="home", odd=oh),
                        RawSelectionOdd(selection_name="draw", odd=od),
                        RawSelectionOdd(selection_name="away", odd=oa),
                    ],
                )
            )

        over = under = None
        for m in events_list:
            if m.get("G") == 17 and m.get("P") == 2.5:
                t = m.get("T")
                c = m.get("C")
                try:
                    c = float(c)
                except (TypeError, ValueError):
                    continue
                if c < 1.01:
                    continue
                if t == 9:
                    over = c
                elif t == 10:
                    under = c
        if over and under:
            markets_out.append(
                RawMarketSnapshot(
                    market_name="totals",
                    selections=[
                        RawSelectionOdd(selection_name="over", odd=over),
                        RawSelectionOdd(selection_name="under", odd=under),
                    ],
                )
            )

        if not markets_out:
            return None

        return RawEventSnapshot(
            source_book_slug="melbet",
            source_event_id=str(ev.get("I") or ev.get("CI") or ""),
            sport_slug="soccer",
            competition_name=str(league),
            home_team_raw=str(home),
            away_team_raw=str(away),
            kickoff_utc=kickoff,
            is_in_play=True,
            markets=markets_out,
            taken_at=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("melbet.parse_failed", error=str(exc))
        return None


async def _fetch_async() -> list[RawEventSnapshot]:
    try:
        body = await fetch_json_with_browser("melbet-ng", _api_url(), landing=LANDING)
    except Exception as exc:  # noqa: BLE001
        log.warning("melbet.fetch_failed", error=str(exc))
        return []
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        log.warning("melbet.not_json", preview=body[:200])
        return []
    events = data.get("Value") or []
    if not isinstance(events, list):
        return []
    log.info("melbet.fetched", count=len(events))
    out: list[RawEventSnapshot] = []
    for ev in events:
        if isinstance(ev, dict):
            parsed = _parse_event(ev)
            if parsed:
                out.append(parsed)
    log.info("melbet.done", snapshots=len(out))
    return out


def fetch_live() -> list[RawEventSnapshot]:
    return asyncio.run(_fetch_async())
