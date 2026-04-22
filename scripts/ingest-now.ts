/**
 * One-shot ingestion + detection pipeline.
 * Fetches The Odds API for soccer leagues, normalizes, writes odds_snapshots,
 * runs arbitrage + value detectors, writes signals.
 *
 * Usage: npm run ingest:now
 */
import 'dotenv/config';
import { eq, and, desc, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import {
  findOrCreateCompetition,
  findOrCreateEvent,
  findOrCreateTeam,
  toaMarketSelection,
} from '../src/lib/normalize/entities';
import { detectArbitrage, type LatestOdd } from '../src/lib/detectors/arbitrage';
import { detectValueBets } from '../src/lib/detectors/value-bet';

const TOA_KEY = process.env.THE_ODDS_API_KEY;
if (!TOA_KEY) {
  console.error('Missing THE_ODDS_API_KEY in .env');
  process.exit(1);
}

const BASE = 'https://api.the-odds-api.com/v4';

// Map TOA sport keys → our canonical (sport_slug, competition_name)
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

// TOA bookmaker key → our book slug (subset — rest are ignored)
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
  // ADM italian-facing books
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
    markets: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number; point?: number }>;
    }>;
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

async function main() {
  console.log('=== OddsRadar one-shot ingest ===');

  const sportsAll = await db.select().from(schema.sports);
  const booksAll = await db.select().from(schema.books);
  const marketsAll = await db.select().from(schema.markets);
  const selectionsAll = await db.select().from(schema.selections);

  const bookBySlug = new Map(booksAll.map((b) => [b.slug, b]));

  let totalSnapshots = 0;
  const touchedEventIds = new Set<number>();
  const takenAt = new Date();

  for (const s of TOA_SPORTS) {
    const sport = sportsAll.find((x) => x.slug === s.sportSlug);
    if (!sport) continue;
    console.log(`\n> ${s.competition}`);

    const events = await fetchSport(s.key);
    if (events.length === 0) continue;

    const competitionId = await findOrCreateCompetition(sport.id, s.competition);

    for (const ev of events) {
      const { id: homeId } = await findOrCreateTeam(sport.id, ev.home_team);
      const { id: awayId } = await findOrCreateTeam(sport.id, ev.away_team);
      const kickoff = new Date(ev.commence_time);
      const eventId = await findOrCreateEvent(competitionId, homeId, awayId, kickoff);
      touchedEventIds.add(eventId);

      const snapshotsToInsert: Array<{
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
            snapshotsToInsert.push({
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

      if (snapshotsToInsert.length > 0) {
        await db.insert(schema.oddsSnapshots).values(snapshotsToInsert);
        totalSnapshots += snapshotsToInsert.length;
      }
    }
  }

  console.log(`\n✓ Ingestion done: ${totalSnapshots} odds_snapshots, ${touchedEventIds.size} events`);

  // === DETECTION PHASE ===
  console.log('\n=== Detection ===');

  let arbCount = 0;
  let valueCount = 0;
  const sharpSet = new Set(SHARP_SLUGS);

  for (const eventId of touchedEventIds) {
    const latest = await db
      .select({
        bookId: schema.oddsSnapshots.bookId,
        bookSlug: schema.books.slug,
        marketId: schema.oddsSnapshots.marketId,
        selectionId: schema.oddsSnapshots.selectionId,
        selectionSlug: schema.selections.slug,
        odd: schema.oddsSnapshots.odd,
        takenAt: schema.oddsSnapshots.takenAt,
      })
      .from(schema.oddsSnapshots)
      .innerJoin(schema.books, eq(schema.books.id, schema.oddsSnapshots.bookId))
      .innerJoin(schema.selections, eq(schema.selections.id, schema.oddsSnapshots.selectionId))
      .where(eq(schema.oddsSnapshots.eventId, eventId))
      .orderBy(desc(schema.oddsSnapshots.takenAt));

    // Group by marketId then dedupe to latest snapshot per (book, selection)
    const byMarket = new Map<number, LatestOdd[]>();
    for (const row of latest) {
      const key = `${row.bookId}:${row.selectionId}`;
      if (!byMarket.has(row.marketId)) byMarket.set(row.marketId, []);
      const arr = byMarket.get(row.marketId)!;
      if (!arr.some((a) => `${a.bookId}:${a.selectionId}` === key)) {
        arr.push({
          bookId: row.bookId,
          bookSlug: row.bookSlug,
          selectionId: row.selectionId,
          selectionSlug: row.selectionSlug,
          odd: row.odd,
          takenAt: row.takenAt,
        });
      }
    }

    for (const [marketId, odds] of byMarket) {
      // ARBITRAGE
      const arb = detectArbitrage(odds);
      const arbMin = Number(process.env.ARB_EDGE_MIN ?? '0.005');
      if (arb && arb.edge >= arbMin) {
        await db.insert(schema.signals).values({
          type: 'arb',
          eventId,
          marketId,
          edge: arb.edge,
          payload: arb as unknown as Record<string, unknown>,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        });
        arbCount++;
      }

      // VALUE (require sharp presence)
      const sharpOdds = odds.filter((o) => sharpSet.has(o.bookSlug));
      if (sharpOdds.length === 0) continue;
      const edgeMin = Number(process.env.VALUE_EDGE_MIN ?? '0.03');
      const values = detectValueBets(odds, sharpOdds, edgeMin);
      for (const v of values) {
        // skip if the "offering" book is itself a sharp (cross-sharp false signal)
        if (sharpSet.has(v.bookSlug)) continue;
        await db.insert(schema.signals).values({
          type: 'value',
          eventId,
          marketId,
          selectionId: v.selectionId,
          edge: v.edge,
          payload: v as unknown as Record<string, unknown>,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        });
        valueCount++;
      }
    }
  }

  console.log(`✓ Detection done: ${arbCount} ARB signals, ${valueCount} VALUE signals`);

  // Log ingestion run
  for (const [slug] of bookBySlug) {
    if (['pinnacle', 'betfair_ex', 'smarkets'].includes(slug)) {
      const book = bookBySlug.get(slug);
      if (book) {
        await db.insert(schema.ingestionRuns).values({
          bookId: book.id,
          startedAt: takenAt,
          finishedAt: new Date(),
          itemsFetched: totalSnapshots,
          itemsInserted: totalSnapshots,
          errorsCount: 0,
          status: 'success',
          note: 'the_odds_api one-shot',
        });
      }
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
