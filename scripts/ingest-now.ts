/**
 * Ingestion + BestBet detection + Telegram notify.
 */
import 'dotenv/config';
import { eq, desc, gte } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import {
  findOrCreateCompetition,
  findOrCreateEvent,
  findOrCreateTeam,
  toaMarketSelection,
} from '../src/lib/normalize/entities';
import {
  detectBestBets,
  suggestStakeEur,
  type OddsHistoryPoint,
} from '../src/lib/detectors/best-bet';
import type { LatestOdd } from '../src/lib/detectors/arbitrage';
import { persistSignalIfNew, expireOldSignals } from '../src/lib/signals/persist';
import { bookLabel, selectionLabel } from '../src/lib/signals/actionable';
import { formatBestBetMessage, sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';

const TOA_KEY = process.env.THE_ODDS_API_KEY;
if (!TOA_KEY) {
  console.error('Missing THE_ODDS_API_KEY');
  process.exit(1);
}
const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const BASE = 'https://api.the-odds-api.com/v4';

const TOA_SPORTS = [
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
  matchbook: 'matchbook',
  sbobet: 'sbobet',
  '1xbet': '1xbet',
  marathonbet: 'marathonbet',
  unibet_eu: 'unibet',
  betclic: 'bet365',
  williamhill: 'williamhill',
  bwin: 'bwin',
  betsson: 'bwin',
  snai: 'snai',
  goldbet: 'goldbet',
  sisal: 'sisal',
  eurobet: 'eurobet',
};

type ToaEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    markets: Array<{ key: string; outcomes: Array<{ name: string; price: number; point?: number }> }>;
  }>;
};

async function fetchSport(sportKey: string): Promise<ToaEvent[]> {
  const url =
    `${BASE}/sports/${sportKey}/odds?apiKey=${TOA_KEY}` +
    `&regions=eu,uk,us,au&markets=h2h,totals&oddsFormat=decimal`;
  const r = await fetch(url);
  if (!r.ok) {
    console.warn(`  ! ${sportKey}: HTTP ${r.status}`);
    return [];
  }
  const rest = r.headers.get('x-requests-remaining');
  console.log(`  ${sportKey}: ok (quota ${rest})`);
  return (await r.json()) as ToaEvent[];
}

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

const MIN_CONFIDENCE = Number(process.env.BET_MIN_CONFIDENCE ?? '60');
const MIN_EDGE = Number(process.env.BET_MIN_EDGE ?? '0.02');
const MIN_BOOKS = Number(process.env.BET_MIN_BOOKS ?? '6');
const HISTORY_WINDOW_MIN = Number(process.env.STEAM_WINDOW_MIN ?? '10');
const MAX_TELEGRAM_PER_RUN = Number(process.env.MAX_TELEGRAM_PER_RUN ?? '8');

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === ingest+bestbet ===`);

  const expired = await expireOldSignals();
  if (expired > 0) console.log(`  expired ${expired} old signals`);

  const sportsAll = await db.select().from(schema.sports);
  const booksAll = await db.select().from(schema.books);
  const marketsAll = await db.select().from(schema.markets);
  const selectionsAll = await db.select().from(schema.selections);
  const bookBySlug = new Map(booksAll.map((b) => [b.slug, b]));

  // ensure all TOA target books exist in DB (upsert soft)
  const needBookSlugs = ['unibet', 'williamhill', 'bwin', 'marathonbet'];
  for (const slug of needBookSlugs) {
    if (!bookBySlug.has(slug)) {
      const [b] = await db
        .insert(schema.books)
        .values({ slug, name: slug, tier: 'medium' })
        .onConflictDoNothing()
        .returning();
      if (b) bookBySlug.set(slug, b);
    }
  }

  const [admin] = await db
    .select()
    .from(schema.users)
    .orderBy(schema.users.id)
    .limit(1);
  const bankroll = Number(admin?.bankrollEur ?? 500);

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
      touchedEvents.set(eventId, { home: ev.home_team, away: ev.away_team, competition: s.competition, kickoff });

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
            const mapped = toaMarketSelection(marketsAll, selectionsAll, m.key, o.name, ev.home_team, ev.away_team);
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

  // === BEST-BET DETECTION ===
  const historyWindow = new Date(Date.now() - (HISTORY_WINDOW_MIN + 5) * 60_000);
  const candidates: Array<{
    eventId: number;
    marketId: number;
    marketName: string;
    meta: { home: string; away: string; competition: string; kickoff: Date };
    top: ReturnType<typeof detectBestBets>[number];
    stakeEur: number;
  }> = [];

  for (const [eventId, meta] of touchedEvents) {
    // latest odds per (book, market, selection) per evento
    const rows = await db
      .select({
        bookId: schema.oddsSnapshots.bookId,
        bookSlug: schema.books.slug,
        marketId: schema.oddsSnapshots.marketId,
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

    // window per steam
    const historyRows = await db
      .select({
        bookSlug: schema.books.slug,
        marketId: schema.oddsSnapshots.marketId,
        selectionId: schema.oddsSnapshots.selectionId,
        odd: schema.oddsSnapshots.odd,
        takenAt: schema.oddsSnapshots.takenAt,
      })
      .from(schema.oddsSnapshots)
      .innerJoin(schema.books, eq(schema.books.id, schema.oddsSnapshots.bookId))
      .where(
        eq(schema.oddsSnapshots.eventId, eventId),
      )
      .orderBy(desc(schema.oddsSnapshots.takenAt));

    const latestByMarket = new Map<number, { marketName: string; odds: LatestOdd[] }>();
    const historyByMarket = new Map<number, OddsHistoryPoint[]>();
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.marketId}:${row.bookId}:${row.selectionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!latestByMarket.has(row.marketId)) {
        latestByMarket.set(row.marketId, { marketName: row.marketName, odds: [] });
      }
      latestByMarket.get(row.marketId)!.odds.push({
        bookId: row.bookId,
        bookSlug: row.bookSlug,
        selectionId: row.selectionId,
        selectionSlug: row.selectionSlug,
        odd: row.odd,
        takenAt: row.takenAt,
      });
    }
    for (const row of historyRows) {
      if (row.takenAt < historyWindow) continue;
      if (!historyByMarket.has(row.marketId)) historyByMarket.set(row.marketId, []);
      historyByMarket.get(row.marketId)!.push({
        bookSlug: row.bookSlug,
        selectionId: row.selectionId,
        odd: row.odd,
        takenAt: row.takenAt,
      });
    }

    for (const [marketId, { marketName, odds }] of latestByMarket) {
      if (odds.length < MIN_BOOKS) continue;
      const recs = detectBestBets(odds, historyByMarket.get(marketId));
      if (recs.length === 0) continue;
      const top = recs[0];
      if (top.confidence < MIN_CONFIDENCE) continue;
      if (top.edge < MIN_EDGE && top.scores.steamScore < 0.4) continue;

      const stakeEur = suggestStakeEur(bankroll, top.fairProb, top.marketMedianOdd);
      if (stakeEur <= 0) continue;

      candidates.push({ eventId, marketId, marketName, meta, top, stakeEur });
    }
  }

  // Persist + notify in order: prima i più affidabili (confidence desc)
  candidates.sort((a, b) => b.top.confidence - a.top.confidence);
  let betCount = 0;
  let notified = 0;

  for (const c of candidates) {
    const payload = {
      ...c.top,
      bankrollEur: bankroll,
      stakeEur: c.stakeEur,
      marketName: c.marketName,
    };
    const newId = await persistSignalIfNew({
      type: 'bet',
      eventId: c.eventId,
      marketId: c.marketId,
      selectionId: c.top.selectionId,
      edge: c.top.edge,
      payload: payload as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 45 * 60_000),
    });
    if (!newId) continue;
    betCount++;
    if (telegramEnabled() && notified < MAX_TELEGRAM_PER_RUN) {
      const ok = await sendTelegram(
        formatBestBetMessage({
          home: c.meta.home,
          away: c.meta.away,
          competition: c.meta.competition,
          marketName: c.marketName,
          kickoffLocal: fmtIT(c.meta.kickoff),
          selectionLabel: selectionLabel(c.top.selectionSlug, c.meta.home, c.meta.away),
          fairOdd: c.top.fairOdd,
          marketMedianOdd: c.top.marketMedianOdd,
          bestBookName: bookLabel(c.top.bestBookSlug),
          bestBookOdd: c.top.bestBookOdd,
          confidence: c.top.confidence,
          stakeEur: c.stakeEur,
          bankrollEur: bankroll,
          reasoning: c.top.reasoning,
          url: `${SITE_URL}/signals`,
        }),
      );
      if (ok) notified++;
    }
  }

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
      note: `bet=+${betCount} notified=${notified}`,
    });
  }

  const took = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ bet=+${betCount} notified=${notified} in ${took}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
