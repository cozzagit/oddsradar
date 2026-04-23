"""Betcity.ru — scraper DOM via Playwright + BeautifulSoup.

Sito russo, Angular 18 client-side. Niente Cloudflare anti-bot aggressivo.
Playwright rende la pagina, BeautifulSoup estrae eventi.

Struttura DOM (confermata 2026-04-23):
  .line-event                          → riga evento
    .line-event__name-team             → container team (2 nested)
      .line-event__name-text           → team name (x2: home poi away)
    .line-event__time                  → minuto/tempo gioco
    .line-event__score-value           → score "2:1"
    .line-event__main-bets-button
      id="buttonMainDop0"              → 1 (home)
      id="buttonMainDop1"              → X (draw)
      id="buttonMainDop2"              → 2 (away)
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

LIVE_URL = "https://betcity.ru/ru/live"


def _parse_odd(text: str | None) -> float | None:
    if not text:
        return None
    t = text.strip().replace(",", ".")
    m = re.search(r"\d+\.\d+", t)
    if not m:
        return None
    try:
        v = float(m.group(0))
        return v if v >= 1.01 else None
    except ValueError:
        return None


def _extract_teams(ev) -> tuple[str, str] | None:
    """Estrae home, away dai team nested."""
    texts = ev.select(".line-event__name-team .line-event__name-text")
    if len(texts) < 2:
        return None
    home = texts[0].get_text(strip=True)
    away = texts[1].get_text(strip=True)
    if not home or not away:
        return None
    # Rimuove suffissi tipo "(рез)", "(ж)" opzionali → li teniamo, server-side normalization
    return home, away


def _extract_league(ev) -> str:
    """Cerca il titolo lega nel container .line__champ parent."""
    cur = ev.parent
    for _ in range(6):
        if cur is None:
            break
        # Priorità 1: sibling diretto .line-champ__header-name dentro .line__champ
        name_el = cur.select_one(".line-champ__header-name")
        if name_el:
            txt = name_el.get_text(" ", strip=True)
            if txt and len(txt) < 120:
                return txt
        cur = cur.parent
    return "Unknown"


def _parse_event(ev) -> RawEventSnapshot | None:
    teams = _extract_teams(ev)
    if not teams:
        return None
    home, away = teams

    # 1X2
    h = _parse_odd(ev.select_one("#buttonMainDop0").get_text() if ev.select_one("#buttonMainDop0") else None)
    d = _parse_odd(ev.select_one("#buttonMainDop1").get_text() if ev.select_one("#buttonMainDop1") else None)
    a = _parse_odd(ev.select_one("#buttonMainDop2").get_text() if ev.select_one("#buttonMainDop2") else None)

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

    competition = _extract_league(ev)

    return RawEventSnapshot(
        source_book_slug="betcity",
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
        html = await fetch_with_browser("betcity-ru", LIVE_URL, wait_ms=6000)
    except Exception as exc:  # noqa: BLE001
        log.warning("betcity.fetch_failed", error=str(exc))
        return []
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select(".line-event")
    log.info("betcity.dom_events", count=len(rows))
    out: list[RawEventSnapshot] = []
    for ev in rows:
        try:
            parsed = _parse_event(ev)
            if parsed:
                out.append(parsed)
        except Exception as exc:  # noqa: BLE001
            log.warning("betcity.parse_err", error=str(exc))
    # Filtra: solo calcio (molti eventi sono tennis/basket/altro in live)
    # Betcity live mostra tutti gli sport. Per ora accettiamo tutto come "soccer"
    # perché la source_page è live globale — miglioramento futuro: filtrare
    # dal tab sport specifico.
    log.info("betcity.done", snapshots=len(out))
    return out


def fetch_live() -> list[RawEventSnapshot]:
    return asyncio.run(_fetch_async())
