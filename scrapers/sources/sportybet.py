"""SportyBet (Nigeria/Ghana/Kenya/...) — endpoint JSON pubblico.

L'app SportyBet usa un API interna non-protetta:
  https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchEvents
  https://www.sportybet.com/api/ng/factsCenter/liveOrPrematchMarkets
  https://www.sportybet.com/api/ng/factsCenter/liveEvents

Testato: User-Agent realistico basta, niente cookie auth.
Risposta: JSON con events[] → {eventId, homeTeamName, awayTeamName, sport:{...}, markets:[{...}]}

Copriamo calcio (sport=sr:sport:1).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import structlog

from ..common.http import fetch, polite_sleep
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

BASE = "https://www.sportybet.com"

# Endpoint multi-regione: Nigeria (ng) è la più stabile e public.
# Se blocca, provare /api/gh/ (Ghana) /api/ke/ (Kenya) /api/ug/ /api/tz/
REGIONS = ["ng", "gh", "ke"]


def _fetch_region(region: str, path: str) -> dict[str, Any] | None:
    url = f"{BASE}/api/{region}{path}"
    try:
        txt = fetch(url, referer=f"{BASE}/{region}/")
        import json
        return json.loads(txt)
    except Exception as exc:  # noqa: BLE001
        log.warning("sportybet.fetch_failed", region=region, path=path, error=str(exc))
        return None


def _parse_event(ev: dict) -> RawEventSnapshot | None:
    try:
        home = ev.get("homeTeamName") or ev.get("homeTeam") or ""
        away = ev.get("awayTeamName") or ev.get("awayTeam") or ""
        if not home or not away:
            return None
        sport = ev.get("sport") or {}
        sport_id = sport.get("id") or ""
        if "1" not in str(sport_id) and "football" not in str(sport.get("name", "")).lower():
            return None
        # Competition
        tournament = ev.get("tournament") or {}
        category = ev.get("category") or {}
        competition = tournament.get("name") or category.get("name") or "Unknown"
        # Kickoff
        est = ev.get("estimateStartTime") or ev.get("startTime")
        if est and isinstance(est, (int, float)):
            kickoff = datetime.fromtimestamp(est / 1000, tz=timezone.utc)
        else:
            kickoff = datetime.now(timezone.utc)

        # Markets — SportyBet usa markets[] con desc and outcomes[]
        markets_out: list[RawMarketSnapshot] = []
        for m in ev.get("markets", []) or []:
            desc = (m.get("desc") or m.get("name") or "").strip()
            mkt_name_raw = desc.lower()
            if mkt_name_raw in ("1x2", "match result", "three way result", "fulltime result", "result"):
                sels: list[RawSelectionOdd] = []
                for o in m.get("outcomes", []) or []:
                    sel = (o.get("desc") or o.get("shortDesc") or "").strip()
                    odd_str = o.get("odds") or o.get("price") or ""
                    try:
                        odd = float(odd_str)
                    except (TypeError, ValueError):
                        continue
                    if odd < 1.01:
                        continue
                    # Normalize
                    if sel in ("1", "Home", home):
                        sels.append(RawSelectionOdd(selection_name="home", odd=odd))
                    elif sel in ("2", "Away", away):
                        sels.append(RawSelectionOdd(selection_name="away", odd=odd))
                    elif sel.lower() in ("x", "draw"):
                        sels.append(RawSelectionOdd(selection_name="draw", odd=odd))
                if len(sels) == 3:
                    markets_out.append(RawMarketSnapshot(market_name="h2h", selections=sels))
            elif "over/under" in mkt_name_raw or "total" in mkt_name_raw or "o/u" in mkt_name_raw:
                # Filtra linea 2.5
                line = m.get("specifier") or m.get("line") or ""
                if "2.5" not in str(line):
                    continue
                sels_ou: list[RawSelectionOdd] = []
                for o in m.get("outcomes", []) or []:
                    sel = (o.get("desc") or "").strip().lower()
                    odd_str = o.get("odds") or ""
                    try:
                        odd = float(odd_str)
                    except (TypeError, ValueError):
                        continue
                    if odd < 1.01:
                        continue
                    if "over" in sel:
                        sels_ou.append(RawSelectionOdd(selection_name="over", odd=odd))
                    elif "under" in sel:
                        sels_ou.append(RawSelectionOdd(selection_name="under", odd=odd))
                if len(sels_ou) == 2:
                    markets_out.append(RawMarketSnapshot(market_name="totals", selections=sels_ou))

        if not markets_out:
            return None

        return RawEventSnapshot(
            source_book_slug="sportybet",
            source_event_id=str(ev.get("eventId") or ev.get("id") or ""),
            sport_slug="soccer",
            competition_name=str(competition),
            home_team_raw=home,
            away_team_raw=away,
            kickoff_utc=kickoff,
            is_in_play=bool(ev.get("isLive") or ev.get("live")),
            markets=markets_out,
            taken_at=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("sportybet.parse_event_failed", error=str(exc))
        return None


def fetch_live() -> list[RawEventSnapshot]:
    """Eventi live + quote da SportyBet."""
    out: list[RawEventSnapshot] = []
    for region in REGIONS:
        data = _fetch_region(region, "/factsCenter/liveOrPrematchEvents?sportId=sr:sport:1&marketId=1,18&option=1&pageSize=50&pageNum=1")
        if not data:
            # fallback endpoint naming
            data = _fetch_region(region, "/factsCenter/liveEvents?sportId=sr:sport:1")
        polite_sleep(1, 2)
        if not data:
            continue
        events = ((data.get("data") or {}).get("events")) or data.get("events") or []
        if not isinstance(events, list):
            continue
        log.info("sportybet.fetched", region=region, count=len(events))
        for ev in events:
            parsed = _parse_event(ev)
            if parsed:
                out.append(parsed)
        if out:
            break  # prima regione ok basta
    log.info("sportybet.done", snapshots=len(out))
    return out


def fetch_prematch() -> list[RawEventSnapshot]:
    """Prematch (alias, usa stesso endpoint con filtro diverso)."""
    out: list[RawEventSnapshot] = []
    for region in REGIONS:
        data = _fetch_region(
            region,
            "/factsCenter/liveOrPrematchEvents?sportId=sr:sport:1&marketId=1,18&option=0&pageSize=50&pageNum=1",
        )
        polite_sleep(1, 2)
        if not data:
            continue
        events = ((data.get("data") or {}).get("events")) or data.get("events") or []
        if not isinstance(events, list):
            continue
        for ev in events:
            parsed = _parse_event(ev)
            if parsed:
                out.append(parsed)
        if out:
            break
    return out
