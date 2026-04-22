#!/bin/bash
# Probe rapido di tutte le fonti candidate dal VPS.
# Classifica: 200(ok), 403(CF bot), 000(timeout/dns), 301(redirect), 5xx(down), altro.

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

probe() {
  local name="$1" url="$2" method="${3:-GET}" extra_headers="$4" body="${5:-}"
  local code size
  if [ "$method" = "POST" ]; then
    code=$(curl -s -o /tmp/probe_body.out -w "%{http_code}" -X POST "$url" \
      -A "$UA" -H "Accept: application/json,*/*" $extra_headers \
      -H "Content-Type: application/json" -d "${body:-{}}" --max-time 10 2>/dev/null)
  else
    code=$(curl -s -o /tmp/probe_body.out -w "%{http_code}" -L "$url" \
      -A "$UA" -H "Accept: application/json,*/*" $extra_headers --max-time 10 2>/dev/null)
  fi
  size=$(wc -c < /tmp/probe_body.out 2>/dev/null || echo 0)
  head -c 80 /tmp/probe_body.out | tr -d '\n' > /tmp/probe_preview.out
  local preview
  preview=$(cat /tmp/probe_preview.out 2>/dev/null)
  printf "%-20s %-4s %-8s %s\n" "$name" "$code" "${size}B" "${preview:0:60}"
}

echo "=== Balcani / Est Europa ==="
probe "meridianbet.rs"     "https://meridianbet.rs/sr/kladjenje/fudbal/uzivo"
probe "meridianbet.me"     "https://meridianbet.me/sr/kladenje/fudbal/uzivo"
probe "soccerbet.rs"       "https://soccerbet.rs/sr/kladjenje/uzivo"
probe "admiralbet.ro"      "https://www.admiralbet.ro/ro/pariuri/sportive/fotbal/live"
probe "efbet.com"          "https://www.efbet.com/ro/live"
probe "stoiximan.gr"       "https://www.stoiximan.gr/live-betting"
probe "betano.ro"          "https://www.betano.ro/live"
probe "superbet.ro main"   "https://superbet.ro/api/v2/sports/football/live?tzOffset=120"
probe "superbet.ro cdn2"   "https://api.superbet.ro/sports-api/v1/sports/football/events?status=live"

echo ""
echo "=== Asiatici ==="
probe "w88.com"            "https://www.w88.com"
probe "188bet.com"         "https://www.188bet.com"
probe "m88.com"            "https://www.m88.com"
probe "fb88.com"            "https://www.fb88.com"
probe "sbobet.com"          "https://www.sbobet.com"

echo ""
echo "=== Africa ==="
probe "bet9ja"             "https://www.bet9ja.com"
probe "betking.com"        "https://www.betking.com/sports/s/event/live-soccer"
probe "sunbet.co.za"       "https://www.sunbet.co.za/sports/live"
probe "hollywoodbets.net"  "https://www.hollywoodbets.net/sports-soccer"
probe "merrybet.com"       "https://www.merrybet.com/sports"

echo ""
echo "=== Russi / CIS ==="
probe "fon.bet"            "https://www.fon.bet/sports/football/live"
probe "ligastavok.ru"      "https://www.ligastavok.ru/live"
probe "betcity.ru"         "https://betcity.ru/ru/live"
probe "1xstavka.ru"        "https://1xstavka.ru/service-api/LiveFeed/Get1x2_VZip?sports=1&count=10"

echo ""
echo "=== Crypto / grey ==="
probe "stake.com"          "https://stake.com/_api/graphql" POST "" '{"query":"{ sports { name } }"}'
probe "cloudbet.com"       "https://www.cloudbet.com/api/v1/odds/events/live?sport=soccer&limit=5"
probe "thunderpick.io"     "https://thunderpick.io/api/tools/matchlist?type=live"
probe "betus.com.pa"       "https://www.betus.com.pa"

echo ""
echo "=== Other JSON endpoints pubblici noti ==="
probe "bwin live api"      "https://sports.bwin.com/en/sports/api/widget/livescores/football"
probe "snai live api"      "https://www.snai.it/api/livebetting/v1/events/sport/1"
probe "sisal api"          "https://www.sisal.it/scommesse/matchservice/v1/live/events?sportKey=soccer"
probe "goldbet api"        "https://www.goldbet.it/scommesse/api/live/events?sport=football"
probe "eurobet live"       "https://www.eurobet.it/services/sports/json/livescore/soccer"
