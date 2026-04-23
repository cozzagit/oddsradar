"""Deep probe — 40+ fonti loschi aggiuntive non ancora testate.
Asian broker/grey, African veri, Crypto altri, Mirror Russi alternativi,
Exchange/liquidity endpoints.

Run dal VPS: `scrapers/.venv/bin/python scripts/deep-probe.py`
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass

try:
    from curl_cffi import requests as cc
except ImportError:
    import sys; sys.exit("pip install curl_cffi")

try:
    from playwright.async_api import async_playwright, Error as PWError
    HAS_PW = True
except ImportError:
    HAS_PW = False


@dataclass
class T:
    name: str
    url: str
    post_body: dict | None = None
    category: str = ""
    pw: bool = True


TARGETS = [
    # === Asian grey / broker ===
    T("orbitexchange", "https://www.orbitexchange.com/", category="asian-exchange"),
    T("asianconnect", "https://www.asianconnect88.com/", category="asian-broker"),
    T("premier.bet", "https://www.premier.bet/", category="asian-broker"),
    T("betisn", "https://www.betisn.com/", category="asian-sharp"),
    T("sbobet-api", "https://www.sbobet.com/api/pb/sports/live", post_body={}, category="asian-sharp"),
    T("happystar", "https://www.happystar.com/", category="asian-soft"),
    T("888sport-api", "https://www.888sport.it/api/livescores/football", category="asian-soft"),
    T("nextbet", "https://www.nextbet.com/sports/live", category="asian-grey"),
    T("betvictor-api", "https://www.betvictor.com/api/livescore/sports/soccer", category="asian-soft"),

    # === Africa hard ===
    T("gbet.com", "https://www.gbet.com/", category="africa"),
    T("premierbet.cameroon", "https://www.premierbet.cm/", category="africa"),
    T("betwinner-ng", "https://betwinner.ng/en/live/football", category="africa"),
    T("betwinner-ci", "https://betwinner.ci/", category="africa"),
    T("paripesa", "https://paripesa.ng/", category="africa"),
    T("betmaster-ke", "https://betmaster.io/en/live/football", category="africa"),
    T("22bet-ng", "https://22bet.ng/en/live/football", category="africa"),
    T("odibets", "https://www.odibets.com/", category="africa"),
    T("mbet", "https://www.mbet.africa/", category="africa"),

    # === Russi alternative ===
    T("pari.ru", "https://pari.ru/live", category="russia"),
    T("winline.ru", "https://www.winline.ru/line/live", category="russia"),
    T("leon.bet", "https://leon.bet/sports/live", category="russia"),
    T("tennisi.com", "https://tennisi.com/live", category="russia"),
    T("baltbet.ru", "https://www.baltbet.ru/line/live", category="russia"),

    # === Crypto / grey extra ===
    T("bcgame-api", "https://bc.game/_api/sportsbook/events/live?sportId=1", category="crypto"),
    T("sportsbet.io", "https://sportsbet.io/sports/live/soccer", category="crypto"),
    T("rollbit", "https://rollbit.com/sports/football-live", category="crypto"),
    T("duelbits", "https://duelbits.com/sports/live-events", category="crypto"),
    T("oshi.io", "https://oshi.io/en/sports/live", category="crypto"),
    T("betfury", "https://betfury.com/en/sport-betting/live", category="crypto"),
    T("shuffle", "https://shuffle.com/sports/live", category="crypto"),
    T("stake-us", "https://stake.us/sports/soccer", category="crypto-us"),

    # === Exchange + Volume endpoints (SMART MONEY) ===
    T("betfair-exchange", "https://www.betfair.com/exchange/plus/api/bf-exchange/v1/cache/eventgroupnavigation/1", category="exchange"),
    T("matchbook-api", "https://www.matchbook.com/edge/rest/events?sport-ids=15&states=open&include-odds=true&limit=10", category="exchange"),
    T("smarkets-events", "https://api.smarkets.com/v3/events/?state=upcoming&type_domain=sports/football&limit=10", category="exchange"),
    T("betfair-price-api", "https://www.betfair.com/betting/api/event/priceData?marketIds=1.240000001", category="exchange"),

    # === Asian mobile endpoints (spesso less protected) ===
    T("m.bet365-live", "https://mobile.bet365.com/sports/live/soccer", category="mobile"),
    T("m.williamhill", "https://mobile.williamhill.com/sports/football/in-play", category="mobile"),
    T("m.unibet", "https://m.unibet.com/betting/sports/live/football", category="mobile"),

    # === Indian sharp (in-play, volumi attesi alti) ===
    T("rajabets", "https://rajabets.com/live-betting", category="india"),
    T("purewin", "https://www.purewin.com/live", category="india"),
    T("casumo-in", "https://www.casumo.com/in/live-sports", category="india"),

    # === Provider backend (se visibili, oro puro) ===
    T("altenar-bg", "https://sb2frontend-altenar2.biahosted.com/api/widget/GetLiveEvents?sportids=66&timezoneOffset=0&langId=8&skinName=default&configId=0", category="provider"),
    T("digitain-api", "https://sb-data.api.digitain.com/api/v2/public/partner/skin/live", category="provider"),
    T("bet-construct", "https://bc-api.softcode.io/api/Clients/GetSportsWithEvents?language=en&timeZone=1&sportIds=1&type=Live", category="provider"),
    T("openbet-feed", "https://ss-aka-ori-1.sports.coral.co.uk/openbet-ssviewer/Browse/v1/GetEventsList/en/1/0/football/*/live", category="provider"),
    T("kambi-api", "https://eu-offering-api.kambicdn.com/offering/v2018/sbat/event/live/group/1000093190.json?lang=en_US", category="provider"),
]


UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"


def try_curl(t: T) -> tuple[int, str, str]:
    try:
        if t.post_body is not None:
            r = cc.post(t.url, headers={"User-Agent": UA, "Accept": "application/json"},
                        json=t.post_body, impersonate="chrome120", timeout=12)
        else:
            r = cc.get(t.url, headers={"User-Agent": UA, "Accept": "application/json,text/html,*/*"},
                       impersonate="chrome120", timeout=12)
        body = r.text[:300]
        is_cf = "challenge-platform" in body or "cf-chl" in body or "Just a moment" in body
        is_json = body.strip().startswith(("{", "["))
        method = "cf-blocked" if is_cf else ("curl-json" if is_json else "curl-html")
        return r.status_code, method, body[:120]
    except Exception as exc:
        return 0, f"err:{str(exc)[:40]}", ""


async def try_pw(t: T, ctx) -> tuple[int, str, str]:
    page = await ctx.new_page()
    try:
        resp = await page.goto(t.url, timeout=15_000, wait_until="domcontentloaded")
        st = resp.status if resp else 0
        await page.wait_for_timeout(3500)
        c = await page.content()
        is_cf = "cf-chl" in c or "Just a moment" in c or "challenge-platform" in c
        return st, "pw-blocked" if is_cf else "pw", c[:120].replace("\n", " ")
    except Exception as exc:
        return 0, f"pw-err:{str(exc)[:40]}", ""
    finally:
        await page.close()


async def main():
    print(f"=== DEEP PROBE {len(TARGETS)} targets ===\n")
    results = []
    for t in TARGETS:
        status, method, prev = try_curl(t)
        results.append((t, status, method, prev))
        ok = status == 200 and "blocked" not in method and "err" not in method
        color = "\033[32m" if ok else "\033[33m"
        print(f"{color}[{method:14s}] {t.name:24s} [{t.category:13s}] {status:4d}  {prev[:60]}\033[0m")

    if HAS_PW:
        retry = [t for t, st, m, _ in results if st in (0, 403, 503) or "blocked" in m or "err" in m]
        if retry:
            print(f"\n=== PW RETRY: {len(retry)} ===\n")
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
                ctx = await browser.new_context(user_agent=UA, locale="en-US", viewport={"width": 1440, "height": 900})
                await ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
                for t in retry:
                    status, method, prev = await try_pw(t, ctx)
                    for i, (tt, *_) in enumerate(results):
                        if tt.name == t.name:
                            results[i] = (tt, status, method, prev)
                            break
                    color = "\033[32m" if (status == 200 and "blocked" not in method) else "\033[33m"
                    print(f"{color}[{method:14s}] {t.name:24s} [{t.category:13s}] {status:4d}  {prev[:60]}\033[0m")
                await browser.close()

    ok = [(t, st, m, p) for t, st, m, p in results if st == 200 and "blocked" not in m and "err" not in m]
    print(f"\n=== SUMMARY ===")
    print(f"Total: {len(results)} · OK: {len(ok)}")
    print(f"\nSURVIVORS:")
    for t, st, m, _ in sorted(ok, key=lambda x: x[0].category):
        print(f"  [{t.category:14s}] {t.name:24s} ({m})")


if __name__ == "__main__":
    asyncio.run(main())
