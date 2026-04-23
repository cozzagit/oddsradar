"""PremierBet Angola — scraper DOM via Playwright + BeautifulSoup.

Sito africano (.co.ao), portoghese. No Cloudflare anti-bot aggressivo.
Struttura DOM confermata 2026-04-23:
  .event-card              → riga evento
    .event-card__team-name → team (x2, home / away)
    .odds-button__price    → quote (x3, ordine home/draw/away)
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import structlog
from bs4 import BeautifulSoup

from ..common.browser import fetch_with_browser
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

LIVE_URL = "https://www.premierbet.co.ao/sports/live"


def _parse_odd(text: str) -> float | None:
    m = re.search(r"\d+\.\d+", text.replace(",", "."))
    if not m:
        return None
    try:
        v = float(m.group(0))
        return v if 1.01 <= v <= 1000 else None
    except ValueError:
        return None


def _parse_card(card) -> RawEventSnapshot | None:
    teams = card.select(".event-card__team-name")
    if len(teams) < 2:
        return None
    home = teams[0].get_text(strip=True)
    away = teams[1].get_text(strip=True)
    if not home or not away:
        return None

    # Primi 3 odds-button__price = 1X2 (home/draw/away)
    prices = card.select(".odds-button__price")
    if len(prices) < 3:
        return None
    h = _parse_odd(prices[0].get_text(strip=True))
    d = _parse_odd(prices[1].get_text(strip=True))
    a = _parse_odd(prices[2].get_text(strip=True))

    markets: list[RawMarketSnapshot] = []
    if h and d and a:
        markets.append(
            RawMarketSnapshot(
                market_name="h2h",
                selections=[
                    RawSelectionOdd(selection_name="home", odd=h),
                    RawSelectionOdd(selection_name="draw", odd=d),
                    RawSelectionOdd(selection_name="away", odd=a),
                ],
            )
        )

    if not markets:
        return None

    # League: cerca tra i parents
    competition = "Unknown"
    cur = card.parent
    for _ in range(4):
        if cur is None:
            break
        sel = cur.select_one(
            "[class*='league'], [class*='category'], [class*='tournament'], h2, h3"
        )
        if sel:
            txt = sel.get_text(strip=True)
            if txt and 3 < len(txt) < 80:
                competition = txt
                break
        cur = cur.parent

    return RawEventSnapshot(
        source_book_slug="premierbet",
        source_event_id=None,
        sport_slug="soccer",
        competition_name=competition,
        home_team_raw=home,
        away_team_raw=away,
        kickoff_utc=datetime.now(timezone.utc),
        is_in_play=True,
        markets=markets,
        taken_at=datetime.now(timezone.utc),
    )


async def _fetch_async() -> list[RawEventSnapshot]:
    try:
        html = await fetch_with_browser("premierbet-ao", LIVE_URL, wait_ms=7000)
    except Exception as exc:  # noqa: BLE001
        log.warning("premierbet.fetch_failed", error=str(exc))
        return []
    soup = BeautifulSoup(html, "lxml")
    cards = soup.select(".event-card")
    log.info("premierbet.dom_cards", count=len(cards))
    out: list[RawEventSnapshot] = []
    for card in cards:
        try:
            parsed = _parse_card(card)
            if parsed:
                out.append(parsed)
        except Exception as exc:  # noqa: BLE001
            log.warning("premierbet.parse_err", error=str(exc))
    log.info("premierbet.done", snapshots=len(out))
    return out


def fetch_live() -> list[RawEventSnapshot]:
    return asyncio.run(_fetch_async())
