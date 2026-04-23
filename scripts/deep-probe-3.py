"""Third round probe — 30 nuove fonti bassifondi + prediction markets."""
from __future__ import annotations
import asyncio, sys
try:
    from curl_cffi import requests as cc
except ImportError:
    sys.exit("pip install curl_cffi")
try:
    from playwright.async_api import async_playwright
    HAS_PW = True
except ImportError:
    HAS_PW = False

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36"

TARGETS = [
    # Prediction / decentralized SPORTS-specific
    ("polymarket-search", "https://gamma-api.polymarket.com/events?tag_id=100350&order=volume&ascending=false&limit=5", "pred"),
    ("sxbet-leagues", "https://api.sx.bet/leagues/active?sportIds=5", "pred"),
    ("sxbet-trades", "https://api.sx.bet/trades?sportIds=5&pageSize=3", "pred"),
    ("predictit-all", "https://www.predictit.org/api/marketdata/all/", "pred"),
    ("kleros-markets", "https://api.kleros.io/v1/markets", "pred"),
    ("omen-gnosis", "https://api.thegraph.com/subgraphs/name/protofire/omen-xdai", "pred"),

    # US grey / crypto crews
    ("bovada-odds", "https://www.bovada.lv/services/sports/event/v2/events/A/description/soccer", "us-grey"),
    ("betonline-api", "https://api.betonline.ag/api/v1/sports/soccer/events", "us-grey"),
    ("mybookie", "https://www.mybookie.ag/sportsbook/soccer/", "us-grey"),
    ("jazzsports", "https://www.jazzsports.ag/sports/soccer", "us-grey"),
    ("betnow", "https://betnow.eu/sports/soccer/", "us-grey"),
    ("heritage-sports", "https://www.heritagesports.eu/sports/soccer-odds", "us-grey"),

    # Balkan deep
    ("maxbet.rs", "https://www.maxbet.rs/sr/ponuda/kladjenje/uzivo", "balkan"),
    ("volcanobet", "https://www.volcanobet.com/live", "balkan"),
    ("balkanbet.rs", "https://www.balkanbet.rs/sr/sport-uzivo", "balkan"),
    ("supersport.rs", "https://www.supersport.rs/sr/ponuda/live", "balkan"),
    ("stsbet.com", "https://www.stsbet.com/en/live-betting/football", "balkan"),
    ("interwetten", "https://www.interwetten.com/en/sports/livebetting/football", "balkan"),

    # African deep
    ("betpawa", "https://www.betpawa.co.ke/events/live", "africa"),
    ("premierbet.ao", "https://www.premierbet.co.ao/sports/live", "africa"),
    ("pinnaclebet-ng", "https://www.pinnaclebet.ng/live", "africa"),
    ("bet9ja-mobile", "https://m.bet9ja.com/home", "africa"),

    # Asian rare
    ("egb.com", "https://egb.com/sports/live", "asian"),
    ("bet-at-home", "https://www.bet-at-home.com/en/sport/live/football", "asian-eu"),
    ("xbet.ag", "https://www.xbet.ag/sports/soccer", "asian"),

    # Provider feeds (B2B) spesso aperti
    ("altenar-neobet", "https://sb2frontend-altenar2.biahosted.com/api/widget/GetLiveEvents?sportids=66&langId=8&skinName=neobet&configId=0&culture=de-DE", "provider"),
    ("oddin-ss-feed", "https://api.oddin.gg/v1/sports/live", "provider"),
    ("betradar-free", "https://api.sportradar.com/soccer/production/v4/en/schedules/live/schedule.json", "provider"),
    ("pinnacle-public", "https://www.pinnacle.com/webapi/1.20/api/sports/soccer/leagues/all", "provider"),
    ("pinnacle-odds", "https://guest.api.arcadia.pinnacle.com/0.1/sports/29/markets/?brandId=0&type=matchups", "provider"),
]

def try_curl(name, url, cat):
    try:
        r = cc.get(url, headers={"User-Agent": UA, "Accept": "application/json,*/*"},
                   impersonate="chrome120", timeout=12)
        body = r.text[:250]
        is_cf = "challenge-platform" in body or "Just a moment" in body
        is_json = body.strip().startswith(("{", "["))
        method = "cf" if is_cf else ("JSON" if is_json else "html")
        return r.status_code, method, body[:100]
    except Exception as exc:
        return 0, f"err:{str(exc)[:30]}", ""

async def main():
    print(f"=== PROBE {len(TARGETS)} ===\n")
    results = []
    for name, url, cat in TARGETS:
        st, m, prev = try_curl(name, url, cat)
        ok = st == 200 and "cf" not in m and "err" not in m
        c = "\033[32m" if ok else "\033[33m"
        print(f"{c}[{m:10s}] {name:24s} [{cat:10s}] {st:4d}  {prev[:60]}\033[0m")
        results.append((name, url, cat, st, m, prev))
    ok = [r for r in results if r[3] == 200 and "cf" not in r[4] and "err" not in r[4]]
    print(f"\n=== OK: {len(ok)}/{len(results)} ===")
    for n, u, c, st, m, _ in sorted(ok, key=lambda x: x[2]):
        print(f"  [{c:12s}] {n:24s} ({m})")

if __name__ == "__main__":
    asyncio.run(main())
