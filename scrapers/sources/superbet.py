"""SuperBet (Romania) — API public GraphQL / REST mobile.

Endpoint testati:
  https://prematch.cdn.superbet.ro/sports-api/v1/sports/football/events
  https://live.cdn.superbet.ro/sports-api/v1/sports/football/events
Niente auth, ritorna JSON con events + markets.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import structlog

from ..common.http import fetch, polite_sleep
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

PREMATCH = "https://prematch.cdn.superbet.ro/sports-api/v1/sports/football/events?tzOffset=120"
LIVE = "https://live.cdn.superbet.ro/sports-api/v1/sports/football/events?tzOffset=120"


def _parse_event(ev: dict) -> RawEventSnapshot | None:
    try:
        participants = ev.get("matchParticipants") or ev.get("participants") or []
        if len(participants) < 2:
            return None
        home = participants[0].get("name") or ""
        away = participants[1].get("name") or ""
        if not home or not away:
            return None

        contest = ev.get("contest") or {}
        comp = contest.get("name") or ev.get("tournamentName") or "Romania"
        ts = ev.get("startTime") or ev.get("matchDate")
        if isinstance(ts, (int, float)):
            kickoff = datetime.fromtimestamp(ts / 1000 if ts > 10**11 else ts, tz=timezone.utc)
        elif isinstance(ts, str):
            try:
                kickoff = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                kickoff = datetime.now(timezone.utc)
        else:
            kickoff = datetime.now(timezone.utc)

        # Markets: "betGroups" con main markets
        markets_out: list[RawMarketSnapshot] = []
        for bg in ev.get("betGroups") or []:
            group_type = (bg.get("type") or bg.get("name") or "").lower()

            if "1x2" in group_type or "fulltime" in group_type or group_type == "main":
                bets = bg.get("bets") or []
                sels: list[RawSelectionOdd] = []
                for bet in bets:
                    name = (bet.get("name") or bet.get("type") or "").lower()
                    odd = float(bet.get("price") or bet.get("odds") or 0)
                    if odd < 1.01:
                        continue
                    if name in ("1", "home"):
                        sels.append(RawSelectionOdd(selection_name="home", odd=odd))
                    elif name in ("x", "draw"):
                        sels.append(RawSelectionOdd(selection_name="draw", odd=odd))
                    elif name in ("2", "away"):
                        sels.append(RawSelectionOdd(selection_name="away", odd=odd))
                if len(sels) == 3:
                    markets_out.append(RawMarketSnapshot(market_name="h2h", selections=sels))

            if "over/under" in group_type or "ou" in group_type or "total goals" in group_type:
                line = bg.get("line") or bg.get("specifier") or ""
                if "2.5" not in str(line):
                    continue
                bets = bg.get("bets") or []
                sels_ou: list[RawSelectionOdd] = []
                for bet in bets:
                    name = (bet.get("name") or "").lower()
                    odd = float(bet.get("price") or 0)
                    if odd < 1.01:
                        continue
                    if "over" in name:
                        sels_ou.append(RawSelectionOdd(selection_name="over", odd=odd))
                    elif "under" in name:
                        sels_ou.append(RawSelectionOdd(selection_name="under", odd=odd))
                if len(sels_ou) == 2:
                    markets_out.append(RawMarketSnapshot(market_name="totals", selections=sels_ou))

        if not markets_out:
            return None

        return RawEventSnapshot(
            source_book_slug="superbet",
            source_event_id=str(ev.get("id") or ev.get("eventId") or ""),
            sport_slug="soccer",
            competition_name=str(comp),
            home_team_raw=str(home),
            away_team_raw=str(away),
            kickoff_utc=kickoff,
            is_in_play=bool(ev.get("isLive") or ev.get("live") or ev.get("status") == "LIVE"),
            markets=markets_out,
            taken_at=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("superbet.parse_failed", error=str(exc))
        return None


def _fetch_json(url: str) -> list[dict]:
    try:
        txt = fetch(url, referer="https://superbet.ro/")
        data = json.loads(txt)
        events = data.get("events") or data.get("data") or data.get("response") or []
        if isinstance(events, list):
            return events
    except Exception as exc:  # noqa: BLE001
        log.warning("superbet.fetch_failed", url=url, error=str(exc))
    return []


def fetch_live() -> list[RawEventSnapshot]:
    events = _fetch_json(LIVE)
    polite_sleep(1, 2)
    log.info("superbet.live_fetched", count=len(events))
    out = [p for p in (_parse_event(e) for e in events) if p]
    log.info("superbet.live_done", snapshots=len(out))
    return out


def fetch_prematch() -> list[RawEventSnapshot]:
    events = _fetch_json(PREMATCH)
    out = [p for p in (_parse_event(e) for e in events) if p]
    return out
