/**
 * PRICE-CHANGE scan: per ogni (book, evento, mercato, selezione) cerca
 * variazioni significative della quota rispetto alla sua stessa storia
 * recente. Genera segnale "quota cambiata" con direction + delta + baseline.
 *
 * Non fa più confronto cross-book (outlier statico).
 */
import 'dotenv/config';
import { eq, gte, desc } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import { detectPriceChanges, type TimedOdd } from '../src/lib/detectors/price-change';
import { persistSignalIfNew, expireOldSignals } from '../src/lib/signals/persist';
import { bookLabel, selectionLabel } from '../src/lib/signals/actionable';
import { sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';
import {
  crossBookConcordance,
  getMatchStateWindow,
  matchStateChanged,
} from '../src/lib/signals/live-context';
import { isNotificationsEnabled } from '../src/lib/settings';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const MAX_TG = Number(process.env.MAX_TELEGRAM_PER_RUN ?? '6');
const THRESHOLD = Number(process.env.PRICE_CHANGE_THRESHOLD ?? '0.05'); // 5%
const BASELINE_MIN = Number(process.env.PRICE_BASELINE_MIN ?? '60');
const RECENCY_MIN = Number(process.env.PRICE_RECENCY_MIN ?? '5');
const HISTORY_LOOKBACK_MIN = BASELINE_MIN + 10;

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === PRICE-CHANGE scan ===`);
  if (!(await isNotificationsEnabled())) {
    console.log('  ⏸ notifications paused — skip');
    return;
  }
  await expireOldSignals();

  const since = new Date(Date.now() - HISTORY_LOOKBACK_MIN * 60_000);

  // Prendo tutto lo storico recente unito a info evento/mercato
  const rows = await db
    .select({
      eventId: schema.oddsSnapshots.eventId,
      marketId: schema.oddsSnapshots.marketId,
      marketName: schema.markets.name,
      selectionId: schema.oddsSnapshots.selectionId,
      selectionSlug: schema.selections.slug,
      bookSlug: schema.books.slug,
      odd: schema.oddsSnapshots.odd,
      takenAt: schema.oddsSnapshots.takenAt,
      isInPlay: schema.oddsSnapshots.isInPlay,
    })
    .from(schema.oddsSnapshots)
    .innerJoin(schema.books, eq(schema.books.id, schema.oddsSnapshots.bookId))
    .innerJoin(schema.markets, eq(schema.markets.id, schema.oddsSnapshots.marketId))
    .innerJoin(schema.selections, eq(schema.selections.id, schema.oddsSnapshots.selectionId))
    .where(gte(schema.oddsSnapshots.takenAt, since))
    .orderBy(desc(schema.oddsSnapshots.takenAt));

  // Map eventId → meta.
  // isLiveNow: evento considerato live SOLO se kickoff è tra 5 min fa e 2.5h fa
  // E almeno uno snapshot live negli ultimi 15 min.
  const eventIds = Array.from(new Set(rows.map((r) => r.eventId)));
  const eventsMeta = new Map<
    number,
    { home: string; away: string; kickoff: Date; competition: string; isLiveNow: boolean }
  >();
  const recentLiveCutoff = Date.now() - 15 * 60_000;
  const liveByEv = new Map<number, boolean>();
  for (const r of rows) {
    if (r.isInPlay && r.takenAt.getTime() >= recentLiveCutoff) liveByEv.set(r.eventId, true);
  }

  if (eventIds.length > 0) {
    const allTeams = await db.select().from(schema.teams);
    const teamName = new Map(allTeams.map((t) => [t.id, t.nameCanonical]));
    const allComp = await db.select().from(schema.competitions);
    const compName = new Map(allComp.map((c) => [c.id, c.name]));
    const evRows = await db.select().from(schema.events);
    const now = Date.now();
    for (const ev of evRows) {
      if (!eventIds.includes(ev.id)) continue;
      const minutesAfterKickoff = (now - ev.kickoffUtc.getTime()) / 60_000;
      const plausiblyInPlay = minutesAfterKickoff > 5 && minutesAfterKickoff < 150;
      const isLiveNow = Boolean(liveByEv.get(ev.id)) && plausiblyInPlay;
      eventsMeta.set(ev.id, {
        home: teamName.get(ev.homeTeamId) ?? '?',
        away: teamName.get(ev.awayTeamId) ?? '?',
        kickoff: ev.kickoffUtc,
        competition: compName.get(ev.competitionId) ?? '?',
        isLiveNow,
      });
    }
  }

  // Raggruppa per (evento+mercato) e invoca detector
  type Key = string;
  const byEvMkt = new Map<
    Key,
    {
      eventId: number;
      marketId: number;
      marketName: string;
      history: TimedOdd[];
    }
  >();
  for (const r of rows) {
    const k = `${r.eventId}:${r.marketId}`;
    if (!byEvMkt.has(k)) {
      byEvMkt.set(k, { eventId: r.eventId, marketId: r.marketId, marketName: r.marketName, history: [] });
    }
    byEvMkt.get(k)!.history.push({
      takenAt: r.takenAt,
      bookSlug: r.bookSlug,
      selectionId: r.selectionId,
      selectionSlug: r.selectionSlug,
      odd: r.odd,
    });
  }

  console.log(`  scan ${byEvMkt.size} events×markets`);

  const [admin] = await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  const bankroll = Number(admin?.bankrollEur ?? 500);

  // Raccogli tutti i segnali, ordina per magnitudo per notifiche
  type Candidate = {
    eventId: number;
    marketId: number;
    marketName: string;
    meta: NonNullable<ReturnType<typeof eventsMeta.get>>;
    sig: ReturnType<typeof detectPriceChanges>[number];
  };
  const candidates: Candidate[] = [];

  for (const [, entry] of byEvMkt) {
    const meta = eventsMeta.get(entry.eventId);
    if (!meta) continue;
    // MOVIMENTO LOSCO solo per eventi LIVE ora.
    if (!meta.isLiveNow) continue;

    const signals = detectPriceChanges(entry.history, {
      thresholdPct: THRESHOLD,
      baselineWindowMinutes: BASELINE_MIN,
      recencyMinutes: RECENCY_MIN,
      minBaselineSamples: 3,
      minRecentSamples: 1,
      maxAgeMinutes: 8,
    });
    for (const s of signals) {
      candidates.push({ eventId: entry.eventId, marketId: entry.marketId, marketName: entry.marketName, meta, sig: s });
    }
  }

  candidates.sort((a, b) => Math.abs(b.sig.changePct) - Math.abs(a.sig.changePct));

  let persisted = 0;
  let notified = 0;
  let skippedScoreChange = 0;
  let skippedMarketConsensus = 0;
  const CONCORDANCE_THRESHOLD = Number(process.env.LIVE_CONCORDANCE_THRESHOLD ?? '0.4');

  const baselineStart = new Date(Date.now() - BASELINE_MIN * 60_000);
  const windowEnd = new Date();

  for (const c of candidates) {
    const isLiveNow = c.meta.isLiveNow;

    // FILTRO 1: score/cartellini cambiati → movimento spiegato dal campo
    const state = await getMatchStateWindow(c.eventId, baselineStart, windowEnd);
    const stateCheck = matchStateChanged(state);
    if (stateCheck.changed) {
      skippedScoreChange++;
      continue;
    }

    // FILTRO 2: altri book hanno seguito lo stesso movimento → mercato, non losco
    const concord = await crossBookConcordance({
      eventId: c.eventId,
      marketId: c.marketId,
      selectionId: c.sig.selectionId,
      targetBookSlug: c.sig.bookSlug,
      windowStart: baselineStart,
      windowEnd,
      targetChangePct: c.sig.changePct,
    });
    if (concord.frac >= CONCORDANCE_THRESHOLD) {
      skippedMarketConsensus++;
      continue;
    }
    const payload = {
      kind: 'price_change',
      selectionSlug: c.sig.selectionSlug,
      bookSlug: c.sig.bookSlug,
      bestBookSlug: c.sig.bookSlug,
      bestBookOdd: c.sig.currentOdd,
      marketMedianOdd: c.sig.currentOdd,
      fairOdd: c.sig.previousOdd,
      fairProb: 1 / c.sig.previousOdd,
      confidence: Math.min(95, 55 + Math.abs(c.sig.changePct) * 300),
      stakeEur: Number((bankroll * 0.01).toFixed(2)),
      bankrollEur: bankroll,
      reasoning: [c.sig.reasoning],
      scores: { sharpEdgeVsSoft: 0, steamScore: 1, minorsEdgeVsSharp: 0, publicMoneyScore: 0 },
      soft: { bookCount: 0, meanOdd: 0, meanImpliedProb: 0 },
      minors: { bookCount: 0, meanOdd: 0 },
      marketName: c.marketName,
      direction: c.sig.direction,
      previousOdd: c.sig.previousOdd,
      currentOdd: c.sig.currentOdd,
      changePct: c.sig.changePct,
      isLive: isLiveNow,
      concordance: concord.frac,
      concordanceMovedBooks: concord.movedBooks,
      concordanceTotalBooks: concord.totalBooks,
      liveElapsed: c.meta.isLiveNow ? undefined : undefined,
    };

    const newId = await persistSignalIfNew({
      type: 'bet',
      eventId: c.eventId,
      marketId: c.marketId,
      selectionId: c.sig.selectionId,
      edge: Math.abs(c.sig.changePct),
      payload: payload as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      dedupWindowMs: 30 * 60_000, // live: 30 min
    });
    if (!newId) continue;
    persisted++;

    if (telegramEnabled() && notified < MAX_TG) {
      const arrow = c.sig.direction === 'drop' ? '📉' : '📈';
      const liveTag = isLiveNow ? '🔴 LIVE · ' : '';
      const kickoffShort = c.meta.kickoff.toLocaleString('it-IT', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Rome',
      });
      const concordLabel =
        concord.totalBooks > 0
          ? `<i>${concord.movedBooks}/${concord.totalBooks} altri book concordi</i>`
          : `<i>unico book con dati</i>`;
      const text =
        `⚫ <b>MOVIMENTO LOSCO</b> ${arrow} ${(c.sig.changePct * 100).toFixed(1)}%\n` +
        `${liveTag}${c.meta.home} – ${c.meta.away}\n` +
        `<i>${c.meta.competition} · ${c.marketName} · ${kickoffShort}</i>\n\n` +
        `👉 <b>${selectionLabel(c.sig.selectionSlug, c.meta.home, c.meta.away)}</b> su <b>${bookLabel(c.sig.bookSlug)}</b>\n` +
        `<code>${c.sig.previousOdd.toFixed(2)}</code> → <code>${c.sig.currentOdd.toFixed(2)}</code> ` +
        `(${c.sig.direction === 'drop' ? 'scesa' : 'salita'} di <b>${Math.abs(c.sig.changePct * 100).toFixed(1)}%</b>)\n\n` +
        `${concordLabel} · score invariato nella finestra\n\n` +
        `<a href="${SITE_URL}/signals">Apri</a>`;
      const ok = await sendTelegram(text);
      if (ok) notified++;
    }
  }

  console.log(
    `  ✓ losco=${persisted} skipped(score)=${skippedScoreChange} skipped(mkt)=${skippedMarketConsensus} tg=${notified} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
