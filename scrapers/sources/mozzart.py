"""Mozzart Bet (Serbia) — endpoint JSON pubblico usato dal sito web.

URL base: https://www.mozzartbet.com
Endpoint testati:
  POST /betoffer/categories  → lista campionati live
  POST /betoffer/matches/live → matches live con quote
Metodo: POST con JSON body {}, response JSON.

Se il POST cambia interfaccia, fallback HTML su /sr/sportski-klad/fudbal.

Mozzart ha anche versioni localizzate (me, ba, mk, ...). Proviamo .com prima.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import structlog
from curl_cffi import requests as cc_requests

from ..common.http import polite_sleep
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

BASE = "https://www.mozzartbet.com"


def _post_json(path: str, body: dict) -> dict | None:
    url = f"{BASE}{path}"
    try:
        r = cc_requests.post(
            url,
            json=body,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Accept-Language": "sr-RS,sr;q=0.9,en;q=0.8",
                "Referer": f"{BASE}/sr/sportski-klad/fudbal",
                "Origin": BASE,
            },
            impersonate="chrome120",
            timeout=20,
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:  # noqa: BLE001
        log.warning("mozzart.post_failed", path=path, error=str(exc))
        return None


def _parse_match(m: dict) -> RawEventSnapshot | None:
    try:
        home = m.get("home") or m.get("homeTeam") or m.get("team1") or ""
        away = m.get("visitor") or m.get("awayTeam") or m.get("team2") or ""
        if not home or not away:
            return None

        competition = m.get("competitionName") or m.get("leagueName") or m.get("sport") or "Unknown"

        ts = m.get("startTime") or m.get("time") or m.get("startDate")
        if isinstance(ts, (int, float)):
            kickoff = datetime.fromtimestamp(ts / 1000 if ts > 10**11 else ts, tz=timezone.utc)
        elif isinstance(ts, str):
            try:
                kickoff = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                kickoff = datetime.now(timezone.utc)
        else:
            kickoff = datetime.now(timezone.utc)

        # Mozzart markets: "oddsMap" o "odds" con keys "1","X","2","under","over"
        odds_map = m.get("oddsMap") or m.get("odds") or {}
        if not isinstance(odds_map, dict):
            return None

        markets_out: list[RawMarketSnapshot] = []

        # 1X2
        try:
            o1 = float(odds_map.get("1") or odds_map.get("KI1") or 0)
            ox = float(odds_map.get("X") or odds_map.get("KIX") or 0)
            o2 = float(odds_map.get("2") or odds_map.get("KI2") or 0)
            if o1 >= 1.01 and ox >= 1.01 and o2 >= 1.01:
                markets_out.append(
                    RawMarketSnapshot(
                        market_name="h2h",
                        selections=[
                            RawSelectionOdd(selection_name="home", odd=o1),
                            RawSelectionOdd(selection_name="draw", odd=ox),
                            RawSelectionOdd(selection_name="away", odd=o2),
                        ],
                    )
                )
        except (TypeError, ValueError):
            pass

        # Over/Under 2.5
        try:
            ou_over = float(odds_map.get("U25") or odds_map.get("O2.5") or odds_map.get("VVG") or 0)
            ou_under = float(odds_map.get("P25") or odds_map.get("U2.5") or odds_map.get("MVG") or 0)
            if ou_over >= 1.01 and ou_under >= 1.01:
                markets_out.append(
                    RawMarketSnapshot(
                        market_name="totals",
                        selections=[
                            RawSelectionOdd(selection_name="over", odd=ou_over),
                            RawSelectionOdd(selection_name="under", odd=ou_under),
                        ],
                    )
                )
        except (TypeError, ValueError):
            pass

        if not markets_out:
            return None

        return RawEventSnapshot(
            source_book_slug="mozzart",
            source_event_id=str(m.get("id") or m.get("matchId") or ""),
            sport_slug="soccer",
            competition_name=str(competition),
            home_team_raw=str(home),
            away_team_raw=str(away),
            kickoff_utc=kickoff,
            is_in_play=bool(m.get("live") or m.get("isLive")),
            markets=markets_out,
            taken_at=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("mozzart.parse_failed", error=str(exc))
        return None


def fetch_live() -> list[RawEventSnapshot]:
    """Recupera match live da Mozzart."""
    out: list[RawEventSnapshot] = []
    body = {"sportId": 1, "sort": 0, "competitionIds": []}
    data = _post_json("/betoffer/matches/live", body)
    polite_sleep(1, 2)
    if not data:
        return out
    items: list[Any] = []
    for k in ("matches", "items", "data", "result"):
        v = data.get(k)
        if isinstance(v, list):
            items = v
            break
    if not items and isinstance(data, list):
        items = data
    log.info("mozzart.fetched", count=len(items))
    for m in items:
        if not isinstance(m, dict):
            continue
        parsed = _parse_match(m)
        if parsed:
            out.append(parsed)
    log.info("mozzart.done", snapshots=len(out))
    return out


def fetch_prematch() -> list[RawEventSnapshot]:
    """Prematch oggi/domani."""
    out: list[RawEventSnapshot] = []
    body = {"sportId": 1, "sort": 0, "competitionIds": [], "timeFilter": "TODAY"}
    data = _post_json("/betoffer/matches/prematch", body)
    if not data:
        return out
    items = data.get("matches") or data.get("items") or []
    for m in items:
        if isinstance(m, dict):
            parsed = _parse_match(m)
            if parsed:
                out.append(parsed)
    return out
