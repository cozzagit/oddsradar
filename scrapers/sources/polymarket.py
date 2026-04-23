"""Polymarket — prediction market decentralizzato.

API: https://gamma-api.polymarket.com/events?tag_id=<league>&active=true&closed=false

A differenza di un book, le quote rappresentano probabilità implicite
scambiate da utenti reali (USDC on-chain). Utilissimo come benchmark
"mercato reale" contro bookmakers algoritmici.

Conversione: outcomePrices[0] = yesPrice (prob 0-1) → odd = 1/prob.
Filtriamo prob < 0.02 (quote > 50) come outlier.

Riutilizza le costanti del progetto Ludopatetico:
  TAG IDs: SOCCER=100350, Serie A=101962, Premier League=82, ecc.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

BASE_URL = "https://gamma-api.polymarket.com"

# Tag IDs (da ludopatetico/src/lib/constants.ts)
TAG_ALL_SOCCER = 100350
LEAGUE_TAGS: dict[str, int] = {
    "Serie A": 101962,
    "Serie B": 102870,
    "Premier League": 82,
    "Bundesliga": 1494,
    "Ligue 1": 102070,
    "La Liga": 780,
    "UEFA Champions League": 1234,
    "UEFA Europa League": 101787,
    "UEFA Conference League": 100787,
}

# Prob floor/ceiling
MIN_PROB = 0.02  # quota max 50
MAX_PROB = 0.98  # quota min 1.02


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
def _get(path: str, params: dict) -> Any:
    url = f"{BASE_URL}{path}"
    with httpx.Client(timeout=20) as client:
        r = client.get(url, params=params, headers={"Accept": "application/json"})
        r.raise_for_status()
        return r.json()


def _parse_prices(raw) -> list[float]:
    """outcomePrices è JSON string o array."""
    if not raw:
        return []
    try:
        arr = raw if isinstance(raw, list) else json.loads(raw)
        return [float(v) if v else 0.0 for v in arr]
    except (ValueError, TypeError, json.JSONDecodeError):
        return []


def _parse_outcomes(raw) -> list[str]:
    if not raw:
        return []
    try:
        arr = raw if isinstance(raw, list) else json.loads(raw)
        return [str(v) for v in arr]
    except (ValueError, TypeError, json.JSONDecodeError):
        return []


def _normalize_name(s: str) -> str:
    return (
        s.lower()
        .replace(" fc", "")
        .replace(" cf", "")
        .replace(" afc", "")
        .replace(" sc", "")
        .strip()
    )


def _event_to_snapshot(event: dict) -> RawEventSnapshot | None:
    try:
        teams = event.get("teams") or []
        if len(teams) < 2:
            return None
        home = teams[0].get("name") or ""
        away = teams[1].get("name") or ""
        if not home or not away:
            return None

        home_norm = _normalize_name(home)
        away_norm = _normalize_name(away)

        # League: se teams hanno "league", usiamo quello. Altrimenti event.title
        league_code = teams[0].get("league") or ""
        competition = league_code or event.get("title", "Soccer")[:60]

        # Kickoff
        start = event.get("startTime") or event.get("startDate")
        if isinstance(start, str):
            try:
                kickoff = datetime.fromisoformat(start.replace("Z", "+00:00"))
            except ValueError:
                kickoff = datetime.now(timezone.utc)
        else:
            kickoff = datetime.now(timezone.utc)

        # Parse markets: 1X2 + O/U 2.5
        home_prob = draw_prob = away_prob = None
        over_prob = under_prob = None

        for market in event.get("markets", []) or []:
            if not market.get("active") or market.get("closed"):
                continue
            prices = _parse_prices(market.get("outcomePrices"))
            outcomes = _parse_outcomes(market.get("outcomes"))
            yes = prices[0] if prices else 0
            if yes <= 0:
                continue
            mtype = (market.get("sportsMarketType") or "").lower()
            gtitle = (market.get("groupItemTitle") or "").lower()
            slug = (market.get("slug") or "").lower()
            question = (market.get("question") or "").lower()

            # Moneyline
            if mtype == "moneyline":
                if "draw" in gtitle or "draw" in question:
                    draw_prob = yes
                elif home_norm and home_norm in gtitle:
                    home_prob = yes
                elif away_norm and away_norm in gtitle:
                    away_prob = yes

            # Totals 2.5
            if mtype == "totals" or "total" in slug:
                if "2.5" in question or "2-5" in slug:
                    if "over" in question or "over" in slug:
                        over_prob = yes
                    elif "under" in question or "under" in slug:
                        under_prob = yes

        markets_out: list[RawMarketSnapshot] = []

        if home_prob and draw_prob and away_prob:
            # Converte prob → odd decimale
            def to_odd(p: float) -> float:
                p = max(MIN_PROB, min(MAX_PROB, p))
                return round(1 / p, 3)

            markets_out.append(
                RawMarketSnapshot(
                    market_name="h2h",
                    selections=[
                        RawSelectionOdd(selection_name="home", odd=to_odd(home_prob)),
                        RawSelectionOdd(selection_name="draw", odd=to_odd(draw_prob)),
                        RawSelectionOdd(selection_name="away", odd=to_odd(away_prob)),
                    ],
                )
            )

        if over_prob and under_prob:
            over_prob = max(MIN_PROB, min(MAX_PROB, over_prob))
            under_prob = max(MIN_PROB, min(MAX_PROB, under_prob))
            markets_out.append(
                RawMarketSnapshot(
                    market_name="totals",
                    selections=[
                        RawSelectionOdd(selection_name="over", odd=round(1 / over_prob, 3)),
                        RawSelectionOdd(selection_name="under", odd=round(1 / under_prob, 3)),
                    ],
                )
            )

        if not markets_out:
            return None

        return RawEventSnapshot(
            source_book_slug="polymarket",
            source_event_id=str(event.get("id") or ""),
            sport_slug="soccer",
            competition_name=str(competition),
            home_team_raw=home,
            away_team_raw=away,
            kickoff_utc=kickoff,
            is_in_play=False,  # Polymarket sono eventi futuri
            markets=markets_out,
            taken_at=datetime.now(timezone.utc),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("polymarket.parse_err", error=str(exc))
        return None


def fetch_prematch() -> list[RawEventSnapshot]:
    """Fetch tutti gli eventi soccer Polymarket attivi."""
    try:
        events = _get(
            "/events",
            {
                "tag_id": TAG_ALL_SOCCER,
                "active": "true",
                "closed": "false",
                "limit": 100,
                "order": "startDate",
                "ascending": "true",
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("polymarket.fetch_failed", error=str(exc))
        return []

    if not isinstance(events, list):
        return []

    log.info("polymarket.events_fetched", count=len(events))
    out: list[RawEventSnapshot] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        parsed = _event_to_snapshot(ev)
        if parsed:
            out.append(parsed)
    log.info("polymarket.done", snapshots=len(out))
    return out
