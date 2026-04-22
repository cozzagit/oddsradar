"""OddsPortal scraper — legge quote 1X2 da pagine "next matches" per lega.

OddsPortal carica le quote via JSON endpoint interno dopo la pagina HTML.
Endpoint pattern (2026): https://www.oddsportal.com/app/{league_path}/next-matches
                        restituisce HTML con data-hash, poi
                        https://www.oddsportal.com/feed/match-odds/{data-hash}/... (JSON)

NOTA: struttura HTML/JSON cambia periodicamente. Questo scraper copre il caso
base (pagina lega → estrazione match URL + quote best). Se il markup cambia,
adattare i selettori in _parse_*.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import structlog
from bs4 import BeautifulSoup

from ..common.http import fetch, polite_sleep
from ..common.models import RawEventSnapshot, RawMarketSnapshot, RawSelectionOdd

log = structlog.get_logger()

BASE = "https://www.oddsportal.com"

# Competizioni principali (URL path → nostro competition_name + sport)
LEAGUES = [
    ("/football/italy/serie-a/", "Serie A", "soccer"),
    ("/football/italy/serie-b/", "Serie B", "soccer"),
    ("/football/england/premier-league/", "Premier League", "soccer"),
    ("/football/spain/laliga/", "La Liga", "soccer"),
    ("/football/germany/bundesliga/", "Bundesliga", "soccer"),
    ("/football/europe/champions-league/", "UEFA Champions League", "soccer"),
]

# Book name OddsPortal → nostro slug (subset italiani soft + alcuni euro)
BOOK_MAP = {
    "Snai": "snai",
    "Goldbet": "goldbet",
    "Sisal": "sisal",
    "Eurobet": "eurobet",
    "bet365": "bet365",
    "Unibet": "bet365",  # fallback
    "1xBet": "1xbet",
    "Pinnacle": "pinnacle",
    "Betfair": "betfair_ex",
    "SBOBET": "sbobet",
}


def _parse_event_list(html: str) -> list[dict]:
    """Estrae lista eventi (home, away, kickoff, match_url) dalla pagina lega.

    Markup OddsPortal 2026 (confermato da snapshot reale):
    - <a href="/football/h2h/<home>-<id>/<away>-<id>/...">
        <div data-testid="date-time-item"><p>Oggi</p><p>21:30</p></div>
        <a data-testid="event-participants">
          <img alt="Barcellona" />
          <img alt="Celta Vigo" />
    """
    soup = BeautifulSoup(html, "lxml")
    events: list[dict] = []
    seen_urls: set[str] = set()

    for link in soup.select("a[href*='/football/h2h/']"):
        href = link.get("href", "")
        if not href or not href.startswith("/football/h2h/"):
            continue
        if href in seen_urls:
            continue
        seen_urls.add(href)

        # Find event-participants container (può essere child o self)
        participants = link.select_one("[data-testid='event-participants']")
        if not participants:
            participants = link
        imgs = participants.select("img[alt]")
        if len(imgs) < 2:
            continue
        home = (imgs[0].get("alt") or "").strip()
        away = (imgs[1].get("alt") or "").strip()
        if not home or not away:
            continue

        # Date/time — best effort
        kickoff = None
        dt_el = link.select_one("[data-testid='date-time-item']")
        if dt_el:
            ps = dt_el.find_all("p")
            if len(ps) >= 2:
                # "Oggi" / "26/04" e "21:30" — basic parse
                time_str = ps[-1].get_text(strip=True)
                m = re.match(r"^(\d{1,2}):(\d{2})$", time_str)
                if m:
                    h, mi = int(m.group(1)), int(m.group(2))
                    now = datetime.now(timezone.utc)
                    kickoff = now.replace(hour=h, minute=mi, second=0, microsecond=0)

        events.append(
            {
                "home": home,
                "away": away,
                "kickoff": kickoff,
                "url": BASE + href if not href.startswith("http") else href,
            }
        )
    return events


def _parse_match_odds(html: str) -> list[tuple[str, dict[str, float]]]:
    """Estrae (book_name, {'home': odd, 'draw': odd, 'away': odd}) dalla pagina match."""
    soup = BeautifulSoup(html, "lxml")
    results: list[tuple[str, dict[str, float]]] = []
    # Tabella quote per-book (structural selectors: OddsPortal 2026)
    for row in soup.select("[data-testid='odds-row'], .oddsTable tr"):
        book_el = row.select_one("[data-testid='bookmaker-name'], .bookmaker, a.book")
        if not book_el:
            continue
        book_name = book_el.get_text(strip=True)
        odd_els = row.select("[data-testid='odd-cell'], td.odd, span.odd")
        if len(odd_els) < 3:
            continue
        try:
            h = float(odd_els[0].get_text(strip=True).replace(",", "."))
            d = float(odd_els[1].get_text(strip=True).replace(",", "."))
            a = float(odd_els[2].get_text(strip=True).replace(",", "."))
        except (ValueError, IndexError):
            continue
        if h < 1.01 or d < 1.01 or a < 1.01:
            continue
        results.append((book_name, {"home": h, "draw": d, "away": a}))
    return results


def fetch_league(league_path: str, competition: str, sport_slug: str, max_events: int = 20) -> list[RawEventSnapshot]:
    """Fetch next matches + odds per lega."""
    out: list[RawEventSnapshot] = []
    try:
        html = fetch(BASE + league_path, referer=BASE + "/")
    except Exception as exc:  # noqa: BLE001
        log.warning("oddsportal.league_fetch_failed", league=league_path, error=str(exc))
        return out

    events = _parse_event_list(html)[:max_events]
    log.info("oddsportal.events_found", league=league_path, count=len(events))
    now = datetime.now(timezone.utc)

    for ev in events:
        polite_sleep()
        try:
            match_html = fetch(ev["url"], referer=BASE + league_path)
        except Exception as exc:  # noqa: BLE001
            log.warning("oddsportal.match_fetch_failed", url=ev["url"], error=str(exc))
            continue

        odds_by_book = _parse_match_odds(match_html)
        if not odds_by_book:
            continue

        # Emetti uno snapshot per book riconosciuto
        kickoff = ev["kickoff"] or (now + timedelta(days=2))
        for book_raw, odds in odds_by_book:
            book_slug = BOOK_MAP.get(book_raw)
            if not book_slug:
                continue
            out.append(
                RawEventSnapshot(
                    source_book_slug=book_slug,
                    source_event_id=None,
                    sport_slug=sport_slug,
                    competition_name=competition,
                    home_team_raw=ev["home"],
                    away_team_raw=ev["away"],
                    kickoff_utc=kickoff,
                    is_in_play=False,
                    markets=[
                        RawMarketSnapshot(
                            market_name="h2h",
                            selections=[
                                RawSelectionOdd(selection_name="home", odd=odds["home"]),
                                RawSelectionOdd(selection_name="draw", odd=odds["draw"]),
                                RawSelectionOdd(selection_name="away", odd=odds["away"]),
                            ],
                        )
                    ],
                    taken_at=now,
                )
            )
    log.info("oddsportal.league_done", league=league_path, snapshots=len(out))
    return out


def fetch_all() -> list[RawEventSnapshot]:
    all_snaps: list[RawEventSnapshot] = []
    for path, comp, sport in LEAGUES:
        all_snaps.extend(fetch_league(path, comp, sport))
        polite_sleep(2, 5)
    return all_snaps
