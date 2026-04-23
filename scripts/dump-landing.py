"""Dump dell'HTML reso da Playwright per i top candidati.
Salva i file in /tmp/oddsradar-dumps/ per analisi offline dei selettori
DOM. Serve per scrivere scraper reali guidati dal markup vero.
"""
import asyncio
import os

from playwright.async_api import async_playwright

TARGETS = [
    ("melbet_ng_live", "https://melbet.ng/en/live/football"),
    ("soccerbet_rs_live", "https://soccerbet.rs/sr/kladjenje/uzivo/18"),
    ("admiralbet_ro_live", "https://www.admiralbet.ro/ro/pariuri/sportive/fotbal/live"),
    ("betcity_ru_live", "https://betcity.ru/ru/live"),
    ("stake_soccer_live", "https://stake.com/sports/soccer"),
    ("thunderpick_live", "https://thunderpick.io/sports/football"),
    ("bet9ja_live", "https://sports.bet9ja.com/"),
    ("fonbet_live", "https://fon.bet/sports/football/live"),
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"


async def main():
    out_dir = "/tmp/oddsradar-dumps"
    os.makedirs(out_dir, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"]
        )
        ctx = await browser.new_context(user_agent=UA, locale="en-US", viewport={"width": 1440, "height": 900})
        await ctx.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => undefined })")
        for name, url in TARGETS:
            page = await ctx.new_page()
            try:
                print(f"→ {name}")
                await page.goto(url, timeout=30_000, wait_until="domcontentloaded")
                await page.wait_for_timeout(7000)
                html = await page.content()
                with open(f"{out_dir}/{name}.html", "w", encoding="utf-8") as f:
                    f.write(html)
                # Screenshot opzionale
                try:
                    await page.screenshot(path=f"{out_dir}/{name}.png", full_page=False)
                except Exception:
                    pass
                print(f"  saved {len(html)}B")
            except Exception as exc:
                print(f"  error: {exc}")
            finally:
                await page.close()
        await browser.close()
    print(f"\n✓ dumps in {out_dir}")


if __name__ == "__main__":
    asyncio.run(main())
