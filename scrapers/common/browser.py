"""Playwright browser helpers con persistent session per book anti-bot.

Uso:
  from scrapers.common.browser import fetch_with_browser
  html = await fetch_with_browser("melbet", "https://melbet.ng/en/live/football")

Mantiene session storage su /tmp/pw-profile-<slug> così la sfida Cloudflare
viene risolta una volta e poi i successivi fetch riusano il cookie.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from playwright.async_api import BrowserContext, async_playwright

log = structlog.get_logger()

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
)


@asynccontextmanager
async def persistent_browser(slug: str) -> AsyncIterator[BrowserContext]:
    """Context persistente per slug (cookies salvati su disco)."""
    profile_dir = f"/tmp/pw-{slug}"
    async with async_playwright() as pw:
        ctx = await pw.chromium.launch_persistent_context(
            profile_dir,
            headless=True,
            user_agent=UA,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        await ctx.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
        )
        try:
            yield ctx
        finally:
            await ctx.close()


async def fetch_with_browser(slug: str, url: str, wait_ms: int = 4000) -> str:
    """Naviga a url con profilo persistente, ritorna HTML dopo render JS."""
    async with persistent_browser(slug) as ctx:
        page = await ctx.new_page()
        try:
            await page.goto(url, timeout=30_000, wait_until="domcontentloaded")
            await page.wait_for_timeout(wait_ms)
            return await page.content()
        finally:
            await page.close()


async def fetch_json_with_browser(slug: str, api_url: str, landing: str | None = None) -> str:
    """Naviga prima alla landing (per ottenere cookie), poi fetch API con fetch() dal browser."""
    async with persistent_browser(slug) as ctx:
        page = await ctx.new_page()
        try:
            if landing:
                await page.goto(landing, timeout=30_000, wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)
            # Chiama API con fetch all'interno del contesto cookie valido
            body = await page.evaluate(
                """async (u) => {
                    const r = await fetch(u, { credentials: 'include' });
                    return await r.text();
                }""",
                api_url,
            )
            return body
        finally:
            await page.close()


def run_sync(coro):
    """Run async func from sync orchestrator."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            return asyncio.run_coroutine_threadsafe(coro, loop).result(timeout=60)
    except RuntimeError:
        pass
    return asyncio.run(coro)
