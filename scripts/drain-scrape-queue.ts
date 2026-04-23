/**
 * Consumer Node: drena la lista Redis `oddsradar:scrape_queue` popolata dagli
 * scraper Python (OddsPortal ecc.), normalizza team/event/market/selection e
 * scrive odds_snapshots nel DB. Gira come processo PM2 long-running.
 *
 * Formato payload (JSON) pushato da scrapers/common/queue.py push_snapshot:
 * {
 *   "name": "snapshot",
 *   "data": {
 *     source_book_slug: string,
 *     sport_slug: string,
 *     competition_name: string,
 *     home_team_raw: string,
 *     away_team_raw: string,
 *     kickoff_utc: ISO string,
 *     markets: [{ market_name: "h2h" | "totals", selections: [{selection_name, odd}] }],
 *     taken_at: ISO string,
 *     ...
 *   }
 * }
 */
import 'dotenv/config';
import IORedis from 'ioredis';
import { db, schema } from '../src/lib/db';
import {
  findOrCreateCompetition,
  findOrCreateEvent,
  findOrCreateTeam,
  toaMarketSelection,
} from '../src/lib/normalize/entities';

const QUEUE_KEY = 'oddsradar:scrape_queue';
const BULL_COMPAT_KEY = 'bull:ingest:wait'; // Python push alternative
const redis = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

type RawSnapshot = {
  source_book_slug: string;
  sport_slug: string;
  competition_name: string;
  home_team_raw: string;
  away_team_raw: string;
  kickoff_utc: string;
  markets: Array<{
    market_name: string;
    selections: Array<{ selection_name: string; odd: number }>;
  }>;
  taken_at: string;
  is_in_play?: boolean;
  home_goals?: number | null;
  away_goals?: number | null;
  elapsed_min?: number | null;
  red_cards_home?: number | null;
  red_cards_away?: number | null;
};

async function processOne(snap: RawSnapshot): Promise<number> {
  const sportsAll = await db.select().from(schema.sports);
  const sport = sportsAll.find((s) => s.slug === snap.sport_slug);
  if (!sport) {
    console.warn('unknown sport', snap.sport_slug);
    return 0;
  }

  const booksAll = await db.select().from(schema.books);
  const book = booksAll.find((b) => b.slug === snap.source_book_slug);
  if (!book) {
    console.warn('unknown book', snap.source_book_slug);
    return 0;
  }

  const marketsAll = await db.select().from(schema.markets);
  const selectionsAll = await db.select().from(schema.selections);

  const competitionId = await findOrCreateCompetition(sport.id, snap.competition_name);
  const { id: homeId } = await findOrCreateTeam(sport.id, snap.home_team_raw);
  const { id: awayId } = await findOrCreateTeam(sport.id, snap.away_team_raw);
  const kickoff = new Date(snap.kickoff_utc);
  const eventId = await findOrCreateEvent(competitionId, homeId, awayId, kickoff);

  const takenAt = new Date(snap.taken_at);
  const toInsert: Array<{
    takenAt: Date;
    eventId: number;
    marketId: number;
    selectionId: number;
    bookId: number;
    odd: number;
    isInPlay: boolean;
  }> = [];

  for (const m of snap.markets) {
    for (const o of m.selections) {
      const mapped = toaMarketSelection(
        marketsAll,
        selectionsAll,
        m.market_name === 'h2h' ? 'h2h' : m.market_name === 'totals' ? 'totals' : 'unknown',
        o.selection_name,
        snap.home_team_raw,
        snap.away_team_raw,
      );
      if (!mapped) continue;
      toInsert.push({
        takenAt,
        eventId,
        marketId: mapped.marketId,
        selectionId: mapped.selectionId,
        bookId: book.id,
        odd: Number(o.odd),
        isInPlay: false,
      });
    }
  }

  if (toInsert.length === 0) return 0;
  await db.insert(schema.oddsSnapshots).values(toInsert);

  // Event live state (se scraper ha fornito goals/elapsed)
  if (snap.is_in_play && (snap.home_goals != null || snap.elapsed_min != null)) {
    try {
      await db.insert(schema.eventLiveStates).values({
        eventId,
        takenAt,
        homeGoals: snap.home_goals ?? null,
        awayGoals: snap.away_goals ?? null,
        elapsedMin: snap.elapsed_min ?? null,
        status: 'in_play',
        redCardsHome: snap.red_cards_home ?? 0,
        redCardsAway: snap.red_cards_away ?? 0,
      });
    } catch {
      // non blocca l'ingestion odds se la state insert fallisce
    }
  }

  return toInsert.length;
}

async function main() {
  console.log(`[${new Date().toISOString()}] drain-scrape-queue starting`);
  let processed = 0;
  let inserted = 0;
  while (true) {
    // BRPOP blocks up to 5s waiting for items
    const res = await redis.brpop(QUEUE_KEY, BULL_COMPAT_KEY, 5);
    if (!res) continue;
    const [, raw] = res;
    try {
      const parsed = JSON.parse(raw) as { data?: RawSnapshot } | RawSnapshot;
      const data: RawSnapshot = 'data' in parsed && parsed.data ? parsed.data : (parsed as RawSnapshot);
      const n = await processOne(data);
      processed++;
      inserted += n;
      if (processed % 20 === 0) {
        console.log(`  processed=${processed} inserted=${inserted}`);
      }
    } catch (err) {
      console.warn('drain parse/process error:', (err as Error).message);
    }
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

void main();
