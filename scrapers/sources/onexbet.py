"""1xBet — endpoint JSON interno per listing live.

URL:
  https://1xbet.com/service-api/LiveFeed/Get1x2_VZip?sports=1&count=50&antiCacheStamp=...

Protezione: Cloudflare lieve, ma curl_cffi con impersonate Chrome bypassa
quasi sempre da datacenter europeo. Se un VPS viene flaggato, ruotare
User-Agent e ritentare.

Nota: gli URL di 1xBet cambiano su ogni mirror regionale
(1xbet.com, 1xbet.kz, etc). Iniziamo con .com + fallback.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import structlog

from ..common.http import fetch, polite_sleep
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

HOSTS = ["https://1xbet.com", "https://1xbet.ng", "https://1xbet.kz"]


def _event_url(host: str) -> str:
    anti = int(time.time() * 1000)
    return f"{host}/service-api/LiveFeed/Get1x2_VZip?sports=1&count=60&antiCacheStamp={anti}&lng=en"


def _events_url(host: str) -> str:
    anti = int(time.time() * 1000)
    return f"{host}/service-api/LiveFeed/GetTopGamesStatZip?sports=1&count=50&antiCacheStamp={anti}&lng=en"


def _parse_event(ev: dict) -> RawEventSnapshot | None:
    """1xBet struct:
      O1 = home team name, O2 = away team name
      L  = league name
      S  = start timestamp (sec)
      E  = markets list: each {G: group_id, T: type, C: coeff}
      Market IDs:
        1: 1X2 (T=1 home, T=2 draw, T=3 away)
        17: Total goals (T=9 Over 2.5, T=10 Under 2.5 with P=2.5)
    """
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

        # 1X2
        oh = od = oa = None
        for m in events_list:
            if m.get("G") == 1:
                t = m.get("T")
                c = m.get("C")
                if not c:
                    continue
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

        # Over/Under 2.5 (group G=17, P=2.5)
        over = under = None
        for m in events_list:
            if m.get("G") == 17 and m.get("P") == 2.5:
                t = m.get("T")
                c = m.get("C")
                if not c:
                    continue
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


def fetch_live() -> list[RawEventSnapshot]:
    out: list[RawEventSnapshot] = []
    for host in HOSTS:
        url = _event_url(host)
        try:
            txt = fetch(url, referer=f"{host}/en/live/football")
            data = json.loads(txt)
            events = data.get("Value") or data.get("value") or []
            if not isinstance(events, list):
                continue
            log.info("1xbet.fetched", host=host, count=len(events))
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                parsed = _parse_event(ev)
                if parsed:
                    out.append(parsed)
            if out:
                break
        except Exception as exc:  # noqa: BLE001
            log.warning("1xbet.fetch_failed", host=host, error=str(exc))
            polite_sleep(1, 2)
            continue
    log.info("1xbet.done", snapshots=len(out))
    return out
