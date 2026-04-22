/**
 * Live ingest (API-Football /odds/live).
 * NOTA: /odds/live restituisce UN feed aggregato senza attribuzione per book
 * → non abbiamo >= 4 book per fare BestBet. Invece facciamo STEAM DETECTION:
 * confronto la quota "main" attuale con quella dello stesso evento/market
 * negli ultimi N minuti. Se si è mossa > soglia su market principali
 * (Match Winner o Over/Under 2.5), pubblichiamo segnale LIVE.
 */
import 'dotenv/config';
import { and, eq, gte, desc } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import {
  findOrCreateCompetition,
  findOrCreateEvent,
  findOrCreateTeam,
} from '../src/lib/normalize/entities';
import { fetchLiveFixtures, fetchLiveOdds, mapAfMarket } from '../src/lib/sources/api-football';
import { persistSignalIfNew, expireOldSignals } from '../src/lib/signals/persist';
import { selectionLabel } from '../src/lib/signals/actionable';
import { formatBetMessage, sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const LIVE_STEAM_PCT = Number(process.env.LIVE_STEAM_PCT ?? '0.06'); // 6%
const LIVE_WINDOW_MIN = Number(process.env.LIVE_WINDOW_MIN ?? '10');
const MAX_TG = Number(process.env.MAX_TELEGRAM_PER_RUN ?? '6');
const MIN_ODD = 1.35; // scartiamo favorite estreme
const MAX_ODD = 10.0;

const VIRTUAL_BOOK_SLUG = 'api_football_live';

// Suggerisce stake semplice per live: 1% bankroll se edge drift > 6%, 2% se > 10%.
function suggestLiveStake(bankroll: number, dropPct: number): number {
  const frac = dropPct >= 0.1 ? 0.02 : dropPct >= 0.06 ? 0.01 : 0.005;
  return Number((bankroll * frac).toFixed(2));
}

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === LIVE ingest (API-Football) ===`);
  await expireOldSignals();

  const fixtures = await fetchLiveFixtures();
  if (fixtures.length === 0) {
    console.log('  no live events right now');
    return;
  }
  const oddsItems = await fetchLiveOdds();
  const oddsByFixture = new Map(oddsItems.map((o) => [o.fixture.id, o]));
  console.log(`  live fixtures ${fixtures.length} / with odds ${oddsItems.length}`);

  const sportsAll = await db.select().from(schema.sports);
  const soccer = sportsAll.find((s) => s.slug === 'soccer')!;
  const marketsAll = await db.select().from(schema.markets);
  const selectionsAll = await db.select().from(schema.selections);
  const marketSlugToId = new Map(marketsAll.map((m) => [m.slug, m.id]));
  const selKey = new Map<string, number>();
  for (const s of selectionsAll) {
    const m = marketsAll.find((mm) => mm.id === s.marketId);
    if (m) selKey.set(`${m.slug}:${s.slug}`, s.id);
  }

  // Ensure virtual book
  let [virtualBook] = await db
    .select()
    .from(schema.books)
    .where(eq(schema.books.slug, VIRTUAL_BOOK_SLUG))
    .limit(1);
  if (!virtualBook) {
    const [created] = await db
      .insert(schema.books)
      .values({
        slug: VIRTUAL_BOOK_SLUG,
        name: 'API-Football Live Feed',
        tier: 'easy',
        isSharp: false,
      })
      .returning();
    virtualBook = created;
  }

  const [admin] = await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  const bankroll = Number(admin?.bankrollEur ?? 500);

  const takenAt = new Date();
  const touchedEvents = new Map<
    number,
    { home: string; away: string; competition: string; kickoff: Date; elapsed: number }
  >();
  let totalSnapshots = 0;

  // ── 1) Persist snapshots ──
  const inserts: Array<{
    takenAt: Date;
    eventId: number;
    marketId: number;
    selectionId: number;
    bookId: number;
    odd: number;
    isInPlay: boolean;
  }> = [];

  for (const fx of fixtures) {
    const oi = oddsByFixture.get(fx.fixture.id);
    if (!oi) continue;

    const competitionId = await findOrCreateCompetition(soccer.id, fx.league.name);
    const { id: homeId } = await findOrCreateTeam(soccer.id, fx.teams.home.name);
    const { id: awayId } = await findOrCreateTeam(soccer.id, fx.teams.away.name);
    const kickoff = new Date(fx.fixture.date);
    const eventId = await findOrCreateEvent(competitionId, homeId, awayId, kickoff);

    touchedEvents.set(eventId, {
      home: fx.teams.home.name,
      away: fx.teams.away.name,
      competition: fx.league.name,
      kickoff,
      elapsed: fx.fixture.status.elapsed ?? 0,
    });

    // `oi.odds` è array di market; ogni market ha .values con value/odd/handicap/main
    // Prendiamo SOLO main=true e market di nostro interesse
    type AfOddMarket = { id: number; name: string; values: Array<{ value: string; odd: string; handicap?: string; main?: boolean | null; suspended?: boolean }> };
    const markets: AfOddMarket[] = (oi as unknown as { odds: AfOddMarket[] }).odds ?? [];
    for (const m of markets) {
      for (const v of m.values) {
        if (v.suspended) continue;
        // main è null nei feed live più recenti → includiamo tutto e filtriamo per handicap=2.5
        const mapped = mapAfMarket(m.name, v.value, v.handicap, fx.teams.home.name, fx.teams.away.name);
        if (!mapped) continue;
        if (mapped.marketSlug === 'over_under_2_5' && v.handicap !== '2.5' && v.handicap !== '2') continue;
        const odd = Number(v.odd);
        if (!Number.isFinite(odd) || odd < MIN_ODD || odd > MAX_ODD) continue;
        const marketId = marketSlugToId.get(mapped.marketSlug);
        const selectionId = selKey.get(`${mapped.marketSlug}:${mapped.selectionSlug}`);
        if (!marketId || !selectionId) continue;
        inserts.push({
          takenAt,
          eventId,
          marketId,
          selectionId,
          bookId: virtualBook.id,
          odd,
          isInPlay: true,
        });
      }
    }
  }

  if (inserts.length > 0) {
    await db.insert(schema.oddsSnapshots).values(inserts);
    totalSnapshots = inserts.length;
  }
  console.log(`  LIVE snapshots: ${totalSnapshots}`);

  // ── 2) Steam detection: compare current snapshot con il più vecchio nella finestra ──
  const windowStart = new Date(Date.now() - LIVE_WINDOW_MIN * 60_000);
  const candidates: Array<{
    eventId: number;
    marketId: number;
    marketName: string;
    selectionId: number;
    selectionSlug: string;
    meta: (typeof touchedEvents) extends Map<unknown, infer V> ? V : never;
    oldOdd: number;
    newOdd: number;
    dropPct: number;
    stakeEur: number;
  }> = [];

  for (const [eventId, meta] of touchedEvents) {
    const rows = await db
      .select({
        marketId: schema.oddsSnapshots.marketId,
        marketName: schema.markets.name,
        selectionId: schema.oddsSnapshots.selectionId,
        selectionSlug: schema.selections.slug,
        odd: schema.oddsSnapshots.odd,
        takenAt: schema.oddsSnapshots.takenAt,
      })
      .from(schema.oddsSnapshots)
      .innerJoin(schema.markets, eq(schema.markets.id, schema.oddsSnapshots.marketId))
      .innerJoin(schema.selections, eq(schema.selections.id, schema.oddsSnapshots.selectionId))
      .where(
        and(
          eq(schema.oddsSnapshots.eventId, eventId),
          eq(schema.oddsSnapshots.bookId, virtualBook.id),
          gte(schema.oddsSnapshots.takenAt, windowStart),
        ),
      )
      .orderBy(desc(schema.oddsSnapshots.takenAt));

    // raggruppa per (market, selection)
    const byKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.marketId}:${r.selectionId}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r);
    }

    for (const [, arr] of byKey) {
      if (arr.length < 2) continue;
      const newest = arr[0];
      const oldest = arr[arr.length - 1];
      const ageMin = (newest.takenAt.getTime() - oldest.takenAt.getTime()) / 60_000;
      if (ageMin < 3) continue; // serve almeno 3 minuti di storia
      const dropPct = (oldest.odd - newest.odd) / oldest.odd;
      if (dropPct < LIVE_STEAM_PCT) continue;
      candidates.push({
        eventId,
        marketId: newest.marketId,
        marketName: newest.marketName,
        selectionId: newest.selectionId,
        selectionSlug: newest.selectionSlug,
        meta,
        oldOdd: oldest.odd,
        newOdd: newest.odd,
        dropPct,
        stakeEur: suggestLiveStake(bankroll, dropPct),
      });
    }
  }

  candidates.sort((a, b) => b.dropPct - a.dropPct);
  let notified = 0;
  let persisted = 0;

  for (const c of candidates) {
    const payload = {
      selectionSlug: c.selectionSlug,
      fairOdd: c.newOdd, // best-effort, è la quota corrente
      fairProb: 1 / c.newOdd,
      marketMedianOdd: c.newOdd,
      bestBookSlug: VIRTUAL_BOOK_SLUG,
      bestBookOdd: c.newOdd,
      confidence: Math.min(95, 50 + c.dropPct * 400),
      stakeEur: c.stakeEur,
      bankrollEur: bankroll,
      reasoning: [
        `Steam rilevato IN CORSO: quota calata da <b>${c.oldOdd.toFixed(2)}</b> a <b>${c.newOdd.toFixed(2)}</b> (-${(c.dropPct * 100).toFixed(1)}%) in ~${LIVE_WINDOW_MIN} min.`,
        `Segnale di smart money / evento (gol, espulsione, infortunio). Giocare subito prima che si allinei su tutti i book.`,
      ],
      scores: {
        sharpEdgeVsSoft: 0,
        steamScore: Math.min(1, c.dropPct * 8),
        minorsEdgeVsSharp: 0,
        publicMoneyScore: 0,
      },
      soft: { bookCount: 0, meanOdd: 0, meanImpliedProb: 0 },
      minors: { bookCount: 0, meanOdd: 0 },
      marketName: c.marketName,
      isLive: true,
      liveElapsed: c.meta.elapsed,
    };

    const newId = await persistSignalIfNew({
      type: 'bet',
      eventId: c.eventId,
      marketId: c.marketId,
      selectionId: c.selectionId,
      edge: c.dropPct,
      payload: payload as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    if (!newId) continue;
    persisted++;

    if (telegramEnabled() && notified < MAX_TG) {
      const ok = await sendTelegram(
        formatBetMessage({
          home: c.meta.home,
          away: c.meta.away,
          competition: c.meta.competition,
          marketName: c.marketName,
          kickoff: c.meta.kickoff,
          liveElapsed: c.meta.elapsed,
          selectionLabel: selectionLabel(c.selectionSlug, c.meta.home, c.meta.away),
          fairOdd: c.newOdd,
          marketMedianOdd: c.newOdd,
          bestBookName: 'feed live',
          bestBookOdd: c.newOdd,
          confidence: Math.min(95, 50 + c.dropPct * 400),
          stakeEur: c.stakeEur,
          bankrollEur: bankroll,
          reasoning: [
            `Quota calata ${c.oldOdd.toFixed(2)} → ${c.newOdd.toFixed(2)} (-${(c.dropPct * 100).toFixed(1)}%) in ~${LIVE_WINDOW_MIN}min`,
            `Smart money o evento in campo. Gioca subito.`,
          ],
          url: `${SITE_URL}/signals`,
          isLiveSteam: true,
          oldOdd: c.oldOdd,
          newOdd: c.newOdd,
        }),
      );
      if (ok) notified++;
    }
  }

  console.log(`  ✓ LIVE steam=+${persisted} notified=${notified} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
