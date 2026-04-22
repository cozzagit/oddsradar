"""The Odds API source — free tier up to 500 req/mo, paid plans available.

Docs: https://the-odds-api.com/liveapi/guides/v4/
"""
from datetime import datetime, timezone

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from ..common.config import settings
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

BASE = "https://api.the-odds-api.com/v4"

# Map TOA sport keys → our canonical slugs
SPORT_MAP = {
    "soccer_italy_serie_a": ("soccer", "Serie A"),
    "soccer_italy_serie_b": ("soccer", "Serie B"),
    "soccer_epl": ("soccer", "Premier League"),
    "soccer_spain_la_liga": ("soccer", "La Liga"),
    "soccer_germany_bundesliga": ("soccer", "Bundesliga"),
    "soccer_france_ligue_one": ("soccer", "Ligue 1"),
    "soccer_uefa_champs_league": ("soccer", "UEFA Champions League"),
    "soccer_uefa_europa_league": ("soccer", "UEFA Europa League"),
}

# Book key → our slug
BOOK_MAP = {
    "pinnacle": "pinnacle",
    "betfair_ex_eu": "betfair_ex",
    "smarkets": "smarkets",
    "sbobet": "sbobet",
    "1xbet": "1xbet",
    "matchbook": "matchbook",
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=2, min=2, max=30))
def _get(path: str, params: dict) -> list[dict]:
    params = {**params, "apiKey": settings.the_odds_api_key}
    with httpx.Client(timeout=20) as client:
        r = client.get(f"{BASE}{path}", params=params)
        r.raise_for_status()
        return r.json()


def fetch_sport(sport_key: str, regions: str = "eu,uk", markets: str = "h2h,totals") -> list[RawEventSnapshot]:
    if not settings.the_odds_api_key:
        log.warning("the_odds_api.no_key")
        return []

    sport_slug, competition_name = SPORT_MAP.get(sport_key, ("soccer", sport_key))
    events = _get(
        f"/sports/{sport_key}/odds",
        {"regions": regions, "markets": markets, "oddsFormat": "decimal"},
    )

    now = datetime.now(timezone.utc)
    out: list[RawEventSnapshot] = []
    for ev in events:
        for book in ev.get("bookmakers", []):
            book_slug = BOOK_MAP.get(book["key"])
            if not book_slug:
                continue
            markets_out: list[RawMarketSnapshot] = []
            for m in book.get("markets", []):
                sels = [
                    RawSelectionOdd(selection_name=o["name"], odd=float(o["price"]))
                    for o in m.get("outcomes", [])
                ]
                if sels:
                    markets_out.append(RawMarketSnapshot(market_name=m["key"], selections=sels))
            if not markets_out:
                continue
            out.append(
                RawEventSnapshot(
                    source_book_slug=book_slug,
                    source_event_id=ev["id"],
                    sport_slug=sport_slug,
                    competition_name=competition_name,
                    home_team_raw=ev["home_team"],
                    away_team_raw=ev["away_team"],
                    kickoff_utc=datetime.fromisoformat(ev["commence_time"].replace("Z", "+00:00")),
                    is_in_play=False,
                    markets=markets_out,
                    taken_at=now,
                )
            )
    log.info("the_odds_api.fetched", sport=sport_key, events=len(out))
    return out
