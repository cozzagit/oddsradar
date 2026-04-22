"""1xBet / 1xstavka — endpoint JSON interno.

1xstavka.ru è il mirror russo che risponde 200 JSON dal VPS italiano.
Usiamo lui come primario. Fallback: 1xbet.ng, 1xbet.com.

Note implementative:
  - Endpoint LiveFeed/Get1x2_VZip: 1X2 main markets
  - Endpoint LiveFeed/GetGamesZip: molte partite live complete
  - sports=1 = calcio
  - Restituisce Value[] anche vuoto quando non ci sono match live
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import structlog

from ..common.http import fetch
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

HOSTS = [
    "https://1xstavka.ru",   # primario, JSON 200 dal VPS IT
    "https://1xbet.ng",      # fallback Nigeria
    "https://1xbet.kz",      # fallback Kazakistan
]


def _event_url(host: str) -> str:
    anti = int(time.time() * 1000)
    return (
        f"{host}/service-api/LiveFeed/Get1x2_VZip?"
        f"sports=1&count=80&mode=4&antiCacheStamp={anti}&lng=en&tf=1000000"
    )


def _games_url(host: str) -> str:
    anti = int(time.time() * 1000)
    return (
        f"{host}/service-api/LiveFeed/GetGamesZip?"
        f"sports=1&count=80&antiCacheStamp={anti}&lng=en&mode=4"
    )


def _parse_event(ev: dict) -> RawEventSnapshot | None:
    try:
        home = ev.get("O1") or ev.get("O1E") or ""
        away = ev.get("O2") or ev.get("O2E") or ""
        if not home or not away:
            return None
        league = ev.get("L") or ev.get("LE") or "Unknown"
        ts = ev.get("S") or 0
        if isinstance(ts, (int, float)) and ts > 0:
            kickoff = datetime.fromtimestamp(ts, tz=timezone.utc)
        else:
            kickoff = datetime.now(timezone.utc)

        events_list = ev.get("E") or []
        markets_out: list[RawMarketSnapshot] = []

        # 1X2 — G=1
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

        # Over/Under 2.5 — G=17 P=2.5
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
            source_book_slug="1xbet",
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
        log.warning("1xbet.parse_failed", error=str(exc))
        return None


def _try_host(host: str) -> list[RawEventSnapshot]:
    """Prova prima GetGamesZip (più dati), poi Get1x2_VZip."""
    out: list[RawEventSnapshot] = []
    for url_fn, name in [(_games_url, "games"), (_event_url, "1x2")]:
        url = url_fn(host)
        try:
            txt = fetch(url, referer=f"{host}/line/football")
            data = json.loads(txt)
            events = data.get("Value") or []
            if not isinstance(events, list):
                continue
            log.info("1xbet.fetched", host=host, endpoint=name, count=len(events))
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                parsed = _parse_event(ev)
                if parsed:
                    out.append(parsed)
            if out:
                return out
        except Exception as exc:  # noqa: BLE001
            log.warning("1xbet.fetch_failed", host=host, endpoint=name, error=str(exc))
    return out


def fetch_live() -> list[RawEventSnapshot]:
    out: list[RawEventSnapshot] = []
    for host in HOSTS:
        out = _try_host(host)
        if out:
            break
    log.info("1xbet.done", snapshots=len(out))
    return out
