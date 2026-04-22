"""OddsPortal scraper — placeholder.

OddsPortal ha anti-bot Medium (rate-limit, JS rendering minimale).
Strategy per MVP Sprint 2:
  - curl_cffi con impersonate="chrome" per bypass TLS fingerprint
  - Accept-Language=it-IT
  - rate 20-30 req/min max, sleep randomizzato 1-3s tra richieste
  - endpoint: https://www.oddsportal.com/ajax-next-games/1/0/1/{date}.dat (sospetto, da verificare)
  - parsing DOM con lxml

TODO Sprint 2:
  1. Identificare endpoint JSON nascosti (monitoring network tab)
  2. Implementare login/cookie handling se richiesto per accesso 1X2 completo
  3. Fallback Playwright stealth solo per pagine con JS obbligatorio
"""


def fetch() -> list:
    return []
