"""Soccerbet.rs (Serbia) — REST API pubblica, nessun Cloudflare.

Endpoint principali scoperti:
  /restapi/offer/sr/sports/s/football/mdl/live?desktopVersion=3.1
  /restapi/offer/sr/live-league-events?desktopVersion=3.1

Rispondono JSON con events[] e offer{} (quote).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import structlog

from ..common.http import fetch
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

BASE = "https://www.soccerbet.rs"

# Soccerbet odds keys → nostre selezioni
# Il payload tipico usa keys come "1", "X", "2", "VVG-2" (Over 2+), "MVG-2" (Under 2+), ecc.
# Per O/U 2.5 linea: "VVG-2.5" o varianti.

MARKET_KEYS_1X2 = {"1": "home", "X": "draw", "2": "away", "KI1": "home", "KIX": "draw", "KI2": "away"}
MARKET_KEYS_OU25_OVER = ["U2.5", "VVG-2.5", "VVG2.5", "OVER-2.5", "2+VVG"]
MARKET_KEYS_OU25_UNDER = ["P2.5", "MVG-2.5", "MVG2.5", "UNDER-2.5", "2+MVG"]


def _fetch_json(path: str) -> dict | list | None:
    url = f"{BASE}{path}"
    try:
        txt = fetch(
            url,
            referer=f"{BASE}/sr/kladjenje/uzivo",
            headers={"Accept": "application/json", "Accept-Language": "sr-RS,sr;q=0.9,en;q=0.8"},
        )
        return json.loads(txt)
    except Exception as exc:  # noqa: BLE001
        log.warning("soccerbet.fetch_failed", path=path, error=str(exc))
        return None


def _parse_event(ev: dict) -> RawEventSnapshot | None:
    try:
        # Schema atteso: { id, home, away, kickOffTime o dateTime, leagueName,
        #                  offer: { "1": 2.1, "X": 3.2, "2": 3.3, "VVG-2.5": 1.8, ... } }
        home = ev.get("home") or ev.get("home1") or ev.get("team1") or ""
        away = ev.get("visitor") or ev.get("away") or ev.get("team2") or ""
        if not home or not away:
            return None
        comp = (
            ev.get("leagueName")
            or ev.get("competitionName")
            or ev.get("sportName")
            or "Unknown"
        )

        ts = ev.get("kickOffTime") or ev.get("startTime") or ev.get("dateTime")
        if isinstance(ts, (int, float)):
            kickoff = datetime.fromtimestamp(ts / 1000 if ts > 10**11 else ts, tz=timezone.utc)
        elif isinstance(ts, str):
            try:
                kickoff = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                kickoff = datetime.now(timezone.utc)
        else:
            kickoff = datetime.now(timezone.utc)

        offer = ev.get("offer") or ev.get("odds") or {}
        if not isinstance(offer, dict):
            return None

        markets_out: list[RawMarketSnapshot] = []

        # 1X2
        sels_1x2: dict[str, float] = {}
        for raw_key, sel in MARKET_KEYS_1X2.items():
            v = offer.get(raw_key)
            if v is not None:
                try:
                    odd = float(v)
                    if odd >= 1.01:
                        sels_1x2[sel] = odd
                except (TypeError, ValueError):
                    pass
        if len(sels_1x2) == 3:
            markets_out.append(
                RawMarketSnapshot(
                    market_name="h2h",
                    selections=[
                        RawSelectionOdd(selection_name="home", odd=sels_1x2["home"]),
                        RawSelectionOdd(selection_name="draw", odd=sels_1x2["draw"]),
                        RawSelectionOdd(selection_name="away", odd=sels_1x2["away"]),
                    ],
                )
            )

        # Over/Under 2.5
        over = under = None
        for k in MARKET_KEYS_OU25_OVER:
            if k in offer:
                try:
                    over = float(offer[k])
                    if over < 1.01:
                        over = None
                    break
                except (TypeError, ValueError):
                    pass
        for k in MARKET_KEYS_OU25_UNDER:
            if k in offer:
                try:
                    under = float(offer[k])
                    if under < 1.01:
                        under = None
                    break
                except (TypeError, ValueError):
                    pass
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
            source_book_slug="soccerbet",
            source_event_id=str(ev.get("id") or ev.get("matchId") or ""),
            sport_slug="soccer",
            competition_name=str(comp),
            home_team_raw=str(home),
            away_team_raw=str(away),
            kickoff_utc=kickoff,
            is_in_play=bool(ev.get("live") or ev.get("isLive")),
            markets=markets_out,
            taken_at=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("soccerbet.parse_failed", error=str(exc))
        return None


def _extract_events(data) -> list[dict]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("events", "items", "data", "matches", "response", "esMatchList"):
            v = data.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                for k2 in ("events", "items", "matches"):
                    v2 = v.get(k2)
                    if isinstance(v2, list):
                        return v2
    return []


def fetch_live() -> list[RawEventSnapshot]:
    paths = [
        "/restapi/offer/sr/sports/s/football/mdl/live?desktopVersion=3.1",
        "/restapi/offer/sr/live-league-events?desktopVersion=3.1",
        "/restapi/offer/sr/sport/2/football?desktopVersion=3.1",
    ]
    out: list[RawEventSnapshot] = []
    for p in paths:
        data = _fetch_json(p)
        if not data:
            continue
        events = _extract_events(data)
        log.info("soccerbet.fetched", path=p, count=len(events))
        for ev in events:
            if isinstance(ev, dict):
                parsed = _parse_event(ev)
                if parsed:
                    out.append(parsed)
        if out:
            break
    log.info("soccerbet.done", snapshots=len(out))
    return out
