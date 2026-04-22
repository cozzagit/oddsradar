"""HTTP client con curl_cffi per TLS fingerprint realistico."""
from __future__ import annotations

import random
import time

from curl_cffi import requests
import structlog

log = structlog.get_logger()

_IMPERSONATES = ["chrome120", "chrome119", "chrome116"]


def fetch(url: str, *, headers: dict | None = None, timeout: int = 20, referer: str | None = None) -> str:
    imp = random.choice(_IMPERSONATES)
    h = {"Accept-Language": "it-IT,it;q=0.9,en;q=0.8"}
    if headers:
        h.update(headers)
    if referer:
        h["Referer"] = referer
    r = requests.get(url, headers=h, impersonate=imp, timeout=timeout)
    r.raise_for_status()
    return r.text


def polite_sleep(min_s: float = 1.0, max_s: float = 3.0) -> None:
    time.sleep(random.uniform(min_s, max_s))
