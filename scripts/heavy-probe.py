"""Heavy probe — testa ~50 bookmaker con 3 strategie progressive:
  1. curl_cffi impersonate Chrome (bypass TLS fingerprint)
  2. Playwright headless + stealth (bypass JS challenge / Cloudflare)
  3. Per ciascuno prova anche 2-3 domini alternativi se standard fallisce

Output: tabella ordinata con status + anteprima body.
Run sul VPS: `scrapers/.venv/bin/python scripts/heavy-probe.py`
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from typing import Any

try:
    from curl_cffi import requests as cc_requests
except ImportError:
    print("pip install curl_cffi")
    sys.exit(1)

try:
    from playwright.async_api import async_playwright, Error as PWError
    HAS_PW = True
except ImportError:
    HAS_PW = False


@dataclass
class Target:
    name: str
    urls: list[str]
    post_body: dict | None = None  # if set, makes POST
    json_endpoint: bool = False
    try_playwright: bool = True
    expected_keyword: str | None = None  # body must contain this for success
    family: str = ""


# ─────────── Lista target ───────────
TARGETS: list[Target] = [
    # === 1xbet family (stesso endpoint /service-api/LiveFeed/GetGamesZip) ===
    Target("1xstavka.ru", ["https://1xstavka.ru/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("1xbet.ng", ["https://1xbet.ng/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("melbet.ng", ["https://melbet.ng/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("melbet.kz", ["https://melbet.kz/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("22bet.com", ["https://22bet.com/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("22bet.kz", ["https://22bet.kz/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("betwinner.com", ["https://betwinner.com/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("linebet.com", ["https://linebet.com/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("megapari.com", ["https://megapari.com/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),
    Target("betmaster.io", ["https://betmaster.io/service-api/LiveFeed/GetGamesZip?sports=1&count=5&lng=en"], json_endpoint=True, family="1xbet"),

    # === Balcani ===
    Target("mozzartbet.com", ["https://www.mozzartbet.com", "https://www.mozzartbet.com/sr/sportski-klad/fudbal"], try_playwright=True, family="mozzart"),
    Target("mozzartbet.me", ["https://www.mozzartbet.me"], try_playwright=True, family="mozzart"),
    Target("meridianbet.rs", ["https://meridianbet.rs/sr/kladjenje"], try_playwright=True, family="meridian"),
    Target("meridianbet.me", ["https://meridianbet.me"], try_playwright=True, family="meridian"),
    Target("soccerbet.rs", ["https://soccerbet.rs/sr/kladjenje/uzivo"], try_playwright=True, family="soccerbet"),
    Target("admiralbet.ro", ["https://www.admiralbet.ro/ro/pariuri/sportive/fotbal/live"], try_playwright=True, family="admiral"),
    Target("admiralbet.ba", ["https://www.admiralbet.ba"], try_playwright=True, family="admiral"),
    Target("betano.ro", ["https://www.betano.ro/live"], try_playwright=True, family="betano"),
    Target("betano.gr", ["https://www.betano.gr/live"], try_playwright=True, family="betano"),
    Target("stoiximan.gr", ["https://www.stoiximan.gr/live-betting"], try_playwright=True, family="kaizen"),

    # === Russi/CIS ===
    Target("fon.bet", ["https://fon.bet"], try_playwright=True, family="fonbet"),
    Target("fonbet.kz", ["https://fonbet.kz"], try_playwright=True, family="fonbet"),
    Target("betcity.ru", ["https://betcity.ru/ru/live"], try_playwright=True, family="betcity"),
    Target("ligastavok.ru", ["https://www.ligastavok.ru/live"], try_playwright=True, family="liga"),
    Target("parimatch.com", ["https://www.parimatch.com/live/soccer"], try_playwright=True, family="parimatch"),

    # === Africa ===
    Target("bet9ja.com", ["https://www.bet9ja.com/sports/live"], try_playwright=True, family="bet9ja"),
    Target("sportybet.com.ng", ["https://www.sportybet.com.ng/m/sports/football/live"], try_playwright=True, family="sportybet"),
    Target("betking.com", ["https://www.betking.com/sports"], try_playwright=True, family="betking"),
    Target("merrybet.com", ["https://merrybet.com"], try_playwright=True, family="merrybet"),
    Target("hollywoodbets.net", ["https://www.hollywoodbets.net"], try_playwright=True, family="hollywood"),

    # === Asia (India/SE Asia) ===
    Target("parimatch.in", ["https://parimatch.in"], try_playwright=True, family="parimatch"),
    Target("dafabet.com", ["https://www.dafabet.com", "https://api.dafabet.com/public/sports/v1/events?sportId=1"], try_playwright=True, family="dafabet"),
    Target("fun88.com", ["https://www.fun88.com"], try_playwright=True, family="fun88"),
    Target("12bet.com", ["https://www.12bet.com"], try_playwright=True, family="12bet"),
    Target("188bet.com", ["https://www.188bet.com"], try_playwright=True, family="188bet"),
    Target("10cric.com", ["https://www.10cric.com/sports"], try_playwright=True, family="10cric"),
    Target("w88.com", ["https://www.w88.com"], try_playwright=True, family="w88"),

    # === Grey/crypto ===
    Target("stake.com", ["https://stake.com/sports/soccer"], try_playwright=True, family="stake"),
    Target("bc.game", ["https://bc.game"], try_playwright=True, family="bcgame"),
    Target("thunderpick.io", ["https://thunderpick.io/sports/football"], try_playwright=True, family="thunder"),
    Target("cloudbet.com", ["https://www.cloudbet.com/en/sports/soccer"], try_playwright=True, family="cloudbet"),

    # === Provider-backend endpoints (possibili goldmine) ===
    Target("altenar2-biahosted", ["https://sb2frontend-altenar2.biahosted.com/api/widget/GetEvents?timezoneOffset=-120&langId=8&skinName=betano_ro&configId=9&culture=ro-RO&countryCode=RO&deviceType=Desktop&numFormat=en-GB&integration=betano_ro&sportids=66"], json_endpoint=True, family="altenar"),
    Target("bet365-customdata", ["https://www.bet365.it/customdata/premium/sports_api/v1/soccer_live"], family="bet365"),
    Target("bwin-widget", ["https://sports.bwin.it/en/sports/api/widget/livescores/football"], family="bwin"),
    Target("ic.sbtech.com", ["https://ic.sbtech.com/sb/api/events/v1/livescore"], json_endpoint=True, family="sbtech"),
    Target("bovada-odds", ["https://www.bovada.lv/services/sports/event/v2/events/A/description/soccer?marketFilterId=def"], json_endpoint=True, family="bovada"),

    # === Altre italian soft ===
    Target("sisal.it api", ["https://www.sisal.it/matchservice/v1/live/events?sportKey=soccer"], json_endpoint=True, family="sisal"),
    Target("snai.it api", ["https://www.snai.it/tools/sport/live?group=1"], json_endpoint=True, family="snai"),
    Target("goldbet.it api", ["https://www.goldbet.it/scommesse/api/live/event"], json_endpoint=True, family="goldbet"),
]


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"


def try_curl(target: Target) -> tuple[int, str, str]:
    """Return (status, method, preview)."""
    for url in target.urls:
        try:
            if target.post_body:
                r = cc_requests.post(
                    url,
                    headers={
                        "User-Agent": UA,
                        "Accept": "application/json, text/plain, */*",
                        "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
                        "Content-Type": "application/json",
                    },
                    json=target.post_body,
                    impersonate="chrome120",
                    timeout=15,
                )
            else:
                r = cc_requests.get(
                    url,
                    headers={
                        "User-Agent": UA,
                        "Accept": "application/json, text/html, */*",
                        "Accept-Language": "en-US,en;q=0.9",
                    },
                    impersonate="chrome120",
                    timeout=15,
                )
            body = r.text[:200]
            # Detect Cloudflare challenge
            if "challenge-platform" in body or "cf-chl" in body or "Just a moment" in body:
                return (r.status_code, "cf-blocked", body[:80])
            if target.expected_keyword and target.expected_keyword not in r.text:
                return (r.status_code, "no-keyword", body[:80])
            return (r.status_code, "curl", body[:120])
        except Exception as exc:
            continue
    return (0, "all-failed", "")


async def try_playwright(target: Target, pw_ctx) -> tuple[int, str, str]:
    if not target.try_playwright:
        return (0, "skip-pw", "")
    page = await pw_ctx.new_page()
    try:
        url = target.urls[0]
        try:
            resp = await page.goto(url, timeout=20_000, wait_until="domcontentloaded")
        except PWError as exc:
            return (0, f"pw-err:{str(exc)[:40]}", "")
        status = resp.status if resp else 0
        # Short sleep to allow JS challenge to complete
        await page.wait_for_timeout(2500)
        content = await page.content()
        preview = content[:150].replace("\n", " ")
        has_challenge = "cf-chl" in content or "Challenge validation" in content or "Just a moment" in content
        if has_challenge:
            return (status, "pw-blocked", preview[:80])
        return (status, "pw", preview[:120])
    finally:
        await page.close()


async def main():
    print(f"=== HEAVY PROBE {len(TARGETS)} targets ===\n")
    results: list[tuple[str, str, int, str, str]] = []

    # Phase 1: curl
    for t in TARGETS:
        status, method, preview = try_curl(t)
        results.append((t.family, t.name, status, method, preview))
        color = "\033[32m" if status == 200 and "blocked" not in method and "no-keyword" not in method else "\033[31m" if status == 0 else "\033[33m"
        print(f"{color}[{method:15s}] {t.name:25s} {status:4d}  {preview[:60]}\033[0m")

    # Phase 2: Playwright retry on cf-blocked or 000
    if HAS_PW:
        retry_targets = [t for t, (*_, status, method, _) in zip(TARGETS, results) if (status in (0, 403, 503) or "blocked" in method) and t.try_playwright]
        if retry_targets:
            print(f"\n=== PLAYWRIGHT RETRY: {len(retry_targets)} targets ===\n")
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
                ctx = await browser.new_context(
                    user_agent=UA,
                    viewport={"width": 1440, "height": 900},
                    locale="en-US",
                )
                # Stealth: remove webdriver flag
                await ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => undefined })")
                for t in retry_targets:
                    status, method, preview = await try_playwright(t, ctx)
                    # Update result
                    for i, (fam, name, _, _, _) in enumerate(results):
                        if name == t.name:
                            results[i] = (fam, name, status, method, preview)
                            break
                    color = "\033[32m" if status == 200 and "blocked" not in method else "\033[33m"
                    print(f"{color}[{method:15s}] {t.name:25s} {status:4d}  {preview[:60]}\033[0m")
                await browser.close()
    else:
        print("\n[Playwright not installed — skipping retry]")

    # Summary
    ok = [r for r in results if r[2] == 200 and "blocked" not in r[3] and "no-keyword" not in r[3]]
    print(f"\n=== SUMMARY ===")
    print(f"Total: {len(results)}")
    print(f"OK 200: {len(ok)}")
    print(f"Blocked: {len([r for r in results if 'blocked' in r[3]])}")
    print(f"Failed/DNS: {len([r for r in results if r[2] == 0])}")
    print(f"\nSURVIVORS ({len(ok)}):")
    for fam, name, st, method, prev in ok:
        print(f"  [{fam:10s}] {name:25s} ({method})")


if __name__ == "__main__":
    asyncio.run(main())
