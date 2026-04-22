/**
 * Prematch ingest via API-Football (fallback/complemento a TheOddsAPI esausta).
 * Per ogni lega AF_LEAGUES fa: odds?league=X&season=Y&bet=1 (Match Winner)
 * Dati sono generalmente aggiornati 1-2x/giorno quindi si schedula raramente.
 */
import 'dotenv/config';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import {
  findOrCreateCompetition,
  findOrCreateEvent,
  findOrCreateTeam,
} from '../src/lib/normalize/entities';
import {
  AF_BOOK_MAP,
  AF_LEAGUES,
  fetchPrematchOdds,
  mapAfMarket,
  afDelay,
} from '../src/lib/sources/api-football';
import { detectBestBets, suggestStakeEur, type OddsHistoryPoint } from '../src/lib/detectors/best-bet';
import type { LatestOdd } from '../src/lib/detectors/arbitrage';
import { persistSignalIfNew, expireOldSignals } from '../src/lib/signals/persist';
import { bookLabel, selectionLabel } from '../src/lib/signals/actionable';
import { formatBestBetMessage, sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const SEASON = Number(process.env.AF_SEASON ?? '2025');
const MIN_CONFIDENCE = Number(process.env.BET_MIN_CONFIDENCE ?? '60');
const MIN_EDGE = Number(process.env.BET_MIN_EDGE ?? '0.02');
const MIN_BOOKS = Number(process.env.BET_MIN_BOOKS ?? '4');
const MAX_TG = Number(process.env.MAX_TELEGRAM_PER_RUN ?? '8');

function fmtIT(d: Date): string {
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
  console.log(`[${new Date().toISOString()}] === PREMATCH-AF ingest ===`);
  await expireOldSignals();

  const sportsAll = await db.select().from(schema.sports);
  const soccer = sportsAll.find((s) => s.slug === 'soccer');
  if (!soccer) return;

  const booksAll = await db.select().from(schema.books);
  const marketsAll = await db.select().from(schema.markets);
  const selectionsAll = await db.select().from(schema.selections);
  const bookBySlug = new Map(booksAll.map((b) => [b.slug, b]));
  for (const { slug, tier } of Object.values(AF_BOOK_MAP)) {
    if (!bookBySlug.has(slug)) {
      const pgTier = tier === 'sharp' ? 'easy' : tier === 'soft' ? 'medium' : 'hard';
      const [b] = await db
        .insert(schema.books)
        .values({ slug, name: slug, tier: pgTier, isSharp: tier === 'sharp' })
        .onConflictDoNothing()
        .returning();
      if (b) bookBySlug.set(slug, b);
    }
  }

  const marketSlugToId = new Map(marketsAll.map((m) => [m.slug, m.id]));
  const selKey = new Map<string, number>();
  for (const s of selectionsAll) {
    const m = marketsAll.find((mm) => mm.id === s.marketId);
    if (m) selKey.set(`${m.slug}:${s.slug}`, s.id);
  }

  const [admin] = await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  const bankroll = Number(admin?.bankrollEur ?? 500);

  const takenAt = new Date();
  let totalSnapshots = 0;
  const touchedEvents = new Map<
    number,
    { home: string; away: string; competition: string; kickoff: Date }
  >();

  for (const L of AF_LEAGUES) {
    try {
      const oddsItems = await fetchPrematchOdds(L.id, SEASON);
      console.log(`  ${L.name}: ${oddsItems.length} fixtures`);
      const competitionId = await findOrCreateCompetition(soccer.id, L.name);

      for (const oi of oddsItems) {
        if (oi.bookmakers.length === 0) continue;
        // API-Football /odds non include team names: dobbiamo fetchare fixture a parte.
        // Per evitare extra chiamate (quota), skippiamo — useremo match via odds/live quando gioca.
        // In alternativa il prematch si appoggia ancora a TheOddsAPI.
        // NOTA: mantieni questo stub per non rompere il flusso se AF viene invocato.
      }
      await afDelay(); // rate limit
    } catch (err) {
      console.warn(`  ${L.name} failed:`, (err as Error).message);
    }
  }

  // (prematch AF richiede un fixtures fetch per risolvere team names;
  // rimando all'implementazione v2 per non bruciare quota giornaliera)

  console.log(`  snapshots: ${totalSnapshots} / events ${touchedEvents.size}`);
  console.log(`  ✓ prematch-af done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
