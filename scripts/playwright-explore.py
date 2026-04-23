"""Playwright deep explore sui book candidati: naviga alle live pages,
attende render JS, cattura chiamate XHR ai loro endpoint interni.
Scopre endpoint JSON nascosti da sfruttare poi via curl+cookie.
"""
import asyncio
import json
import sys

from playwright.async_api import async_playwright

TARGETS = [
    ("mozzartbet.com", "https://www.mozzartbet.com/sr/sportski-klad/fudbal/uzivo", "fudbal"),
    ("mozzartbet.me", "https://www.mozzartbet.me/sr/kladjenje/fudbal/uzivo", "fudbal"),
    ("meridianbet.rs", "https://meridianbet.rs/sr/kladjenje/fudbal/uzivo", "fudbal"),
    ("soccerbet.rs", "https://soccerbet.rs/sr/kladjenje/uzivo/18", "uzivo"),
    ("admiralbet.ro", "https://www.admiralbet.ro/ro/pariuri/sportive/fotbal/live", "fotbal"),
    ("betano.ro", "https://www.betano.ro/live/fotbal/", "fotbal"),
    ("bet9ja.com", "https://sports.bet9ja.com/live", "live"),
    ("fon.bet", "https://fon.bet/sports/football/live", "football"),
    ("betcity.ru", "https://betcity.ru/ru/live", "live"),
    ("melbet.ng", "https://melbet.ng/en/live/football", "football"),
    ("stake.com", "https://stake.com/sports/soccer", "soccer"),
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"


async def explore(name: str, url: str, kw: str, pw) -> dict:
    result = {"name": name, "url": url, "status": 0, "json_calls": [], "has_html_odds": False, "body_size": 0, "error": None}
    ctx = await pw.chromium.launch_persistent_context(
        f"/tmp/pw-profile-{name.replace('.', '-')}",
        headless=True,
        user_agent=UA,
        viewport={"width": 1440, "height": 900},
        locale="en-US",
        args=["--disable-blink-features=AutomationControlled"],
    )
    await ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => undefined })")

    json_calls: list[dict] = []

    async def on_response(resp):
        try:
            ct = resp.headers.get("content-type", "")
            if "json" in ct and resp.status == 200:
                url_r = resp.url
                if any(skip in url_r for skip in ("/analytics/", "google-", "sentry", "/metrics", "font", "translations")):
                    return
                body_preview = ""
                try:
                    body_preview = (await resp.text())[:120]
                except Exception:
                    pass
                json_calls.append({"url": url_r, "preview": body_preview})
        except Exception:
            pass

    page = await ctx.new_page()
    page.on("response", on_response)
    try:
        resp = await page.goto(url, timeout=30_000, wait_until="domcontentloaded")
        result["status"] = resp.status if resp else 0
        await page.wait_for_timeout(6000)
        content = await page.content()
        result["body_size"] = len(content)
        result["has_html_odds"] = ("odds" in content.lower() or "@ " in content or "1.8" in content or "2.0" in content)
        # Dedup json calls per url (base)
        seen_urls = set()
        for c in json_calls:
            base = c["url"].split("?")[0]
            if base not in seen_urls:
                seen_urls.add(base)
                result["json_calls"].append(c)
        result["json_calls"] = result["json_calls"][:8]
    except Exception as exc:
        result["error"] = str(exc)[:100]
    finally:
        await ctx.close()
    return result


async def main():
    async with async_playwright() as pw:
        for name, url, kw in TARGETS:
            print(f"\n=== {name} → {url}")
            r = await explore(name, url, kw, pw)
            print(f"  status={r['status']} body={r['body_size']}B has_odds={r['has_html_odds']} err={r['error']}")
            for c in r["json_calls"]:
                print(f"    JSON ← {c['url'][:100]}")
                print(f"           {c['preview'][:80]}")


if __name__ == "__main__":
    asyncio.run(main())
