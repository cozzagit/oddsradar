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
    t = s.lower()
    for pat in (" fc", " cf", " afc", " sc", "ca ", "cs ", "cd ", "sd ", "ac ", "asd "):
        t = t.replace(pat, " ")
    return " ".join(t.split())


def _team_matches(team_norm: str, title: str) -> bool:
    """Match bidirezionale + word-level (es. 'Boca Juniors' vs 'CA Boca Juniors')."""
    if not team_norm or not title:
        return False
    t = title.lower()
    if team_norm in t or t in team_norm:
        return True
    team_words = {w for w in team_norm.split() if len(w) > 3}
    title_words = {w for w in t.split() if len(w) > 3}
    return bool(team_words & title_words)


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
                if "draw" in gtitle or "draw" in question or "pareggio" in gtitle:
                    draw_prob = yes
                elif _team_matches(home_norm, gtitle) or _team_matches(home_norm, question):
                    home_prob = yes
                elif _team_matches(away_norm, gtitle) or _team_matches(away_norm, question):
                    away_prob = yes

            # Totals 2.5
            if mtype == "totals" or "total" in slug:
                if "2.5" in question or "2-5" in slug:
                    if "over" in question or "over" in slug:
                        over_prob = yes
                    elif "under" in question or "under" in slug:
                        under_prob = yes

        # Parse volume per market: Polymarket fornisce volume e liquidity
        # ad ogni market. Li propaghiamo nelle singole selections per tracking.
        market_volumes: dict[str, dict[str, float]] = {}  # key = 'home'/'draw'/'away'/'over'/'under'
        for market in event.get("markets", []) or []:
            if not market.get("active") or market.get("closed"):
                continue
            mtype = (market.get("sportsMarketType") or "").lower()
            gtitle = (market.get("groupItemTitle") or "").lower()
            question = (market.get("question") or "").lower()
            vol = float(market.get("volume") or 0)
            liq = float(market.get("liquidity") or 0)
            if mtype == "moneyline":
                if "draw" in gtitle or "draw" in question:
                    market_volumes["draw"] = {"vol": vol, "liq": liq}
                elif _team_matches(home_norm, gtitle) or _team_matches(home_norm, question):
                    market_volumes["home"] = {"vol": vol, "liq": liq}
                elif _team_matches(away_norm, gtitle) or _team_matches(away_norm, question):
                    market_volumes["away"] = {"vol": vol, "liq": liq}

        def _vol(sel: str) -> float | None:
            v = market_volumes.get(sel)
            return v["vol"] if v else None

        def _liq(sel: str) -> float | None:
            v = market_volumes.get(sel)
            return v["liq"] if v else None

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
                        RawSelectionOdd(selection_name="home", odd=to_odd(home_prob),
                                        matched_volume=_vol("home"), liquidity=_liq("home")),
                        RawSelectionOdd(selection_name="draw", odd=to_odd(draw_prob),
                                        matched_volume=_vol("draw"), liquidity=_liq("draw")),
                        RawSelectionOdd(selection_name="away", odd=to_odd(away_prob),
                                        matched_volume=_vol("away"), liquidity=_liq("away")),
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


def _fetch_tag(tag_id: int, limit: int = 100) -> list[dict]:
    try:
        events = _get(
            "/events",
            {
                "tag_id": tag_id,
                "active": "true",
                "closed": "false",
                "limit": limit,
                "order": "startDate",
                "ascending": "true",
            },
        )
        return events if isinstance(events, list) else []
    except Exception as exc:  # noqa: BLE001
        log.warning("polymarket.tag_fetch_failed", tag_id=tag_id, error=str(exc))
        return []


def fetch_prematch() -> list[RawEventSnapshot]:
    """Fetch Polymarket events da tag globale + singole leghe.
    Più leghe = più match individuali (il tag globale include anche futures/
    tournament winners senza teams[])."""
    seen_ids: set[str] = set()
    out: list[RawEventSnapshot] = []
    all_events: list[dict] = []

    # 1. Global soccer tag
    all_events.extend(_fetch_tag(TAG_ALL_SOCCER, limit=100))

    # 2. Per-lega (include più partite singole che il globale tronca)
    for league_name, tag_id in LEAGUE_TAGS.items():
        league_events = _fetch_tag(tag_id, limit=50)
        log.info("polymarket.league_fetched", league=league_name, count=len(league_events))
        all_events.extend(league_events)

    log.info("polymarket.events_fetched", total=len(all_events))

    for ev in all_events:
        if not isinstance(ev, dict):
            continue
        ev_id = str(ev.get("id") or "")
        if ev_id and ev_id in seen_ids:
            continue
        if ev_id:
            seen_ids.add(ev_id)
        parsed = _event_to_snapshot(ev)
        if parsed:
            out.append(parsed)
    log.info("polymarket.done", snapshots=len(out))
    return out
