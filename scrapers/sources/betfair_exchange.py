"""Betfair Exchange — free delayed API (15-min lag) o paid 499 GBP per real-time.

Docs: https://developer.betfair.com/
Per MVP usiamo delayed free, sufficiente per fair value pre-match.

TODO Sprint 2:
  - implementare login via interactive login (non-JWT)
  - keep-alive session 4h
  - listMarketBook per markets watchlist (ridotto al minimo per quota API)
"""


def fetch() -> list:
    return []
