/**
 * One-shot ingestion + detection + notify pipeline.
 * - Fetch TheOddsAPI per campionati soccer
 * - Normalize team/event/market
 * - Persist odds_snapshots
 * - Run detector arbitrage + value (sharp consensus)
 * - Deduplica signals (finestra 15 min per stesso evento+mercato+tipo)
 * - Expire segnali scaduti
 * - Invia notifica Telegram per OGNI nuovo signal sopra soglia
 *
 * Usage: npm run ingest:now  (oppure scheduler vedi scripts/scheduler.ts)
 */
import 'dotenv/config';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import {
  findOrCreateCompetition,
  findOrCreateEvent,
  findOrCreateTeam,
  toaMarketSelection,
} from '../src/lib/normalize/entities';
import { detectArbitrage, type LatestOdd } from '../src/lib/detectors/arbitrage';
import { detectValueBets } from '../src/lib/detectors/value-bet';
import {
  persistArbSignalIfNew,
  persistValueSignalIfNew,
  expireOldSignals,
} from '../src/lib/signals/persist';
import {
  buildActionableArb,
  buildActionableValue,
} from '../src/lib/signals/actionable';
import {
  formatArbMessage,
  formatValueMessage,
  sendTelegram,
  telegramEnabled,
} from '../src/lib/notify/telegram';

const TOA_KEY = process.env.THE_ODDS_API_KEY;
if (!TOA_KEY) {
  console.error('Missing THE_ODDS_API_KEY in .env');
  process.exit(1);
}

const BASE = 'https://api.the-odds-api.com/v4';
const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3040';

const TOA_SPORTS: Array<{ key: string; sportSlug: string; competition: string }> = [
  { key: 'soccer_italy_serie_a', sportSlug: 'soccer', competition: 'Serie A' },
  { key: 'soccer_italy_serie_b', sportSlug: 'soccer', competition: 'Serie B' },
  { key: 'soccer_epl', sportSlug: 'soccer', competition: 'Premier League' },
  { key: 'soccer_spain_la_liga', sportSlug: 'soccer', competition: 'La Liga' },
  { key: 'soccer_germany_bundesliga', sportSlug: 'soccer', competition: 'Bundesliga' },
  { key: 'soccer_france_ligue_one', sportSlug: 'soccer', competition: 'Ligue 1' },
  { key: 'soccer_uefa_champs_league', sportSlug: 'soccer', competition: 'UEFA Champions League' },
  { key: 'soccer_uefa_europa_league', sportSlug: 'soccer', competition: 'UEFA Europa League' },
];

const TOA_BOOK: Record<string, string> = {
  pinnacle: 'pinnacle',
  betfair_ex_eu: 'betfair_ex',
  betfair: 'betfair_ex',
  smarkets: 'smarkets',
  sbobet: 'sbobet',
  '1xbet': '1xbet',
  matchbook: 'matchbook',
  unibet_eu: 'bet365',
  betclic: 'bet365',
  snai: 'snai',
  goldbet: 'goldbet',
  sisal: 'sisal',
  eurobet: 'eurobet',
};

const SHARP_SLUGS = ['pinnacle', 'betfair_ex', 'smarkets'];

type ToaEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }>;
  }>;
};

async function fetchSport(sportKey: string): Promise<ToaEvent[]> {
  const url = `${BASE}/sports/${sportKey}/odds?apiKey=${TOA_KEY}&regions=eu,uk,us&markets=h2h,totals&oddsFormat=decimal`;
  const r = await fetch(url);
  if (!r.ok) {
    console.warn(`  ! ${sportKey}: HTTP ${r.status}`);
    return [];
  }
  const remaining = r.headers.get('x-requests-remaining');
  console.log(`  ${sportKey}: ok (quota rest: ${remaining})`);
  return (await r.json()) as ToaEvent[];
}

function fmtKickoffIT(d: Date): string {
  return d.toLocaleString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  });
}

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === OddsRadar ingest ===`);

  const expired = await expireOldSignals();
  if (expired > 0) console.log(`  expired ${expired} old signals`);

  const sportsAll = await db.select().from(schema.sports);
  const booksAll = await db.select().from(schema.books);
  const marketsAll = await db.select().from(schema.markets);
  const selectionsAll = await db.select().from(schema.selections);

  const bookBySlug = new Map(booksAll.map((b) => [b.slug, b]));

  let totalSnapshots = 0;
  const touchedEvents = new Map<number, { home: string; away: string; competition: string; kickoff: Date }>();
  const takenAt = new Date();

  for (const s of TOA_SPORTS) {
    const sport = sportsAll.find((x) => x.slug === s.sportSlug);
    if (!sport) continue;
    const events = await fetchSport(s.key);
    if (events.length === 0) continue;

    const competitionId = await findOrCreateCompetition(sport.id, s.competition);

    for (const ev of events) {
      const { id: homeId } = await findOrCreateTeam(sport.id, ev.home_team);
      const { id: awayId } = await findOrCreateTeam(sport.id, ev.away_team);
      const kickoff = new Date(ev.commence_time);
      const eventId = await findOrCreateEvent(competitionId, homeId, awayId, kickoff);
      touchedEvents.set(eventId, {
        home: ev.home_team,
        away: ev.away_team,
        competition: s.competition,
        kickoff,
      });

      const toInsert: Array<{
        takenAt: Date;
        eventId: number;
        marketId: number;
        selectionId: number;
        bookId: number;
        odd: number;
        isInPlay: boolean;
      }> = [];

      for (const bm of ev.bookmakers) {
        const bookSlug = TOA_BOOK[bm.key];
        if (!bookSlug) continue;
        const book = bookBySlug.get(bookSlug);
        if (!book) continue;

        for (const m of bm.markets) {
          for (const o of m.outcomes) {
            const mapped = toaMarketSelection(
              marketsAll,
              selectionsAll,
              m.key,
              o.name,
              ev.home_team,
              ev.away_team,
            );
            if (!mapped) continue;
            toInsert.push({
              takenAt,
              eventId,
              marketId: mapped.marketId,
              selectionId: mapped.selectionId,
              bookId: book.id,
              odd: Number(o.price),
              isInPlay: false,
            });
          }
        }
      }

      if (toInsert.length > 0) {
        await db.insert(schema.oddsSnapshots).values(toInsert);
        totalSnapshots += toInsert.length;
      }
    }
  }

  console.log(`  ingested: ${totalSnapshots} snapshots / ${touchedEvents.size} events`);

  // === DETECTION + NOTIFY ===
  let arbCount = 0;
  let valueCount = 0;
  let notified = 0;
  const sharpSet = new Set(SHARP_SLUGS);
  const ARB_MIN = Number(process.env.ARB_EDGE_MIN ?? '0.005');
  const VALUE_MIN = Number(process.env.VALUE_EDGE_MIN ?? '0.03');

  for (const [eventId, meta] of touchedEvents) {
    const latest = await db
      .select({
        bookId: schema.oddsSnapshots.bookId,
        bookSlug: schema.books.slug,
        marketId: schema.oddsSnapshots.marketId,
        marketSlug: schema.markets.slug,
        marketName: schema.markets.name,
        selectionId: schema.oddsSnapshots.selectionId,
        selectionSlug: schema.selections.slug,
        odd: schema.oddsSnapshots.odd,
        takenAt: schema.oddsSnapshots.takenAt,
      })
      .from(schema.oddsSnapshots)
      .innerJoin(schema.books, eq(schema.books.id, schema.oddsSnapshots.bookId))
      .innerJoin(schema.markets, eq(schema.markets.id, schema.oddsSnapshots.marketId))
      .innerJoin(schema.selections, eq(schema.selections.id, schema.oddsSnapshots.selectionId))
      .where(eq(schema.oddsSnapshots.eventId, eventId))
      .orderBy(desc(schema.oddsSnapshots.takenAt));

    const byMarket = new Map<number, { marketName: string; marketSlug: string; odds: LatestOdd[] }>();
    for (const row of latest) {
      const key = `${row.bookId}:${row.selectionId}`;
      if (!byMarket.has(row.marketId)) {
        byMarket.set(row.marketId, { marketName: row.marketName, marketSlug: row.marketSlug, odds: [] });
      }
      const arr = byMarket.get(row.marketId)!;
      if (!arr.odds.some((a) => `${a.bookId}:${a.selectionId}` === key)) {
        arr.odds.push({
          bookId: row.bookId,
          bookSlug: row.bookSlug,
          selectionId: row.selectionId,
          selectionSlug: row.selectionSlug,
          odd: row.odd,
          takenAt: row.takenAt,
        });
      }
    }

    for (const [marketId, { marketName, odds }] of byMarket) {
      const expiresAt = new Date(Date.now() + 30 * 60_000);

      // ARB
      const arb = detectArbitrage(odds);
      if (arb && arb.edge >= ARB_MIN) {
        const newId = await persistArbSignalIfNew({
          eventId,
          marketId,
          edge: arb.edge,
          payload: arb as unknown as Record<string, unknown>,
          expiresAt,
        });
        if (newId) {
          arbCount++;
          if (telegramEnabled()) {
            const act = buildActionableArb(arb.legs, arb.edge, meta.home, meta.away, 100);
            const ok = await sendTelegram(
              formatArbMessage({
                home: meta.home,
                away: meta.away,
                competition: meta.competition,
                kickoffLocal: fmtKickoffIT(meta.kickoff),
                edgePct: act.guaranteedProfitPct,
                guaranteedProfit: act.guaranteedProfit,
                totalStake: 100,
                legs: act.legs,
                feasibility: act.feasibility,
                url: `${SITE_URL}/signals`,
              }),
            );
            if (ok) notified++;
          }
        }
      }

      // VALUE
      const sharpOdds = odds.filter((o) => sharpSet.has(o.bookSlug));
      if (sharpOdds.length > 0) {
        const values = detectValueBets(odds, sharpOdds, VALUE_MIN);
        for (const v of values) {
          if (sharpSet.has(v.bookSlug)) continue;
          const newId = await persistValueSignalIfNew({
            eventId,
            marketId,
            selectionId: v.selectionId,
            bookId: v.bookId,
            edge: v.edge,
            payload: v as unknown as Record<string, unknown>,
            expiresAt,
          });
          if (newId) {
            valueCount++;
            if (telegramEnabled()) {
              const act = buildActionableValue(
                v.bookSlug,
                v.selectionSlug,
                v.offeredOdd,
                v.fairOdd,
                v.fairProb,
                v.edge,
                meta.home,
                meta.away,
              );
              const ok = await sendTelegram(
                formatValueMessage({
                  home: meta.home,
                  away: meta.away,
                  competition: `${meta.competition} · ${marketName}`,
                  kickoffLocal: fmtKickoffIT(meta.kickoff),
                  label: act.label,
                  bookName: act.bookName,
                  offeredOdd: act.offeredOdd,
                  fairOdd: act.fairOdd,
                  edgePct: act.edgePct,
                  fairProbPct: act.fairProb * 100,
                  suggestedStakePctBankroll: act.suggestedStakePctBankroll,
                  url: `${SITE_URL}/signals`,
                }),
              );
              if (ok) notified++;
            }
          }
        }
      }
    }
  }

  // Log run
  const book = bookBySlug.get('pinnacle');
  if (book) {
    await db.insert(schema.ingestionRuns).values({
      bookId: book.id,
      startedAt: takenAt,
      finishedAt: new Date(),
      itemsFetched: totalSnapshots,
      itemsInserted: totalSnapshots,
      errorsCount: 0,
      status: 'success',
      note: `the_odds_api · +${arbCount} arb / +${valueCount} value / ${notified} notify`,
    });
  }

  const took = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ arb=+${arbCount} value=+${valueCount} notified=${notified} in ${took}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
