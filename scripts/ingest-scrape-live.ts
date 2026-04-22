/**
 * Trigger manuale degli scraper live (invocabile dal VPS via curl o dallo
 * scheduler). Non è lo scraper stesso (Python) — quello gira sempre in
 * background via PM2 `oddsradar-scraper`. Questo script dopo ingest esegue
 * la DIVERGENCE DETECTION su eventi con quote recenti e pubblica signal.
 */
import 'dotenv/config';
import { and, eq, gte, desc } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import {
  detectOutliers,
  detectUnilateralMoves,
  detectMinorCluster,
  type DivOdd,
} from '../src/lib/detectors/divergence';
import { persistSignalIfNew, expireOldSignals } from '../src/lib/signals/persist';
import { bookLabel, selectionLabel } from '../src/lib/signals/actionable';
import { formatBetMessage, sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const MAX_TG = Number(process.env.MAX_TELEGRAM_PER_RUN ?? '6');
const WINDOW_MIN = Number(process.env.DIV_WINDOW_MIN ?? '15');
const OUTLIER_Z = Number(process.env.DIV_OUTLIER_Z ?? '2.5');
const UNI_PCT = Number(process.env.DIV_UNI_PCT ?? '0.08');

const SHARP_SET = new Set(['pinnacle', 'betfair_ex', 'smarkets', 'matchbook', 'sbobet']);
const SOFT_SET = new Set(['snai', 'goldbet', 'sisal', 'eurobet', 'bet365', 'unibet', 'williamhill', 'bwin', 'tipico', 'betway']);
const MINOR_SET = new Set(['1xbet', 'mozzart', 'meridianbet', 'superbet', 'betano', 'fonbet', 'parimatch', 'sportybet', '188bet', 'dafabet', 'api_football_live', 'interwetten']);

function classifyTier(slug: string): 'sharp' | 'soft' | 'minor' | 'unknown' {
  if (SHARP_SET.has(slug)) return 'sharp';
  if (SOFT_SET.has(slug)) return 'soft';
  if (MINOR_SET.has(slug)) return 'minor';
  return 'unknown';
}

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === DIVERGENCE scan ===`);
  await expireOldSignals();

  // Eventi con quote negli ultimi WINDOW_MIN minuti (live o imminente)
  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const rows = await db
    .select({
      eventId: schema.oddsSnapshots.eventId,
      home: schema.teams.nameCanonical,
      away: schema.teams.nameCanonical,
      kickoff: schema.events.kickoffUtc,
      competition: schema.competitions.name,
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
    .innerJoin(schema.events, eq(schema.events.id, schema.oddsSnapshots.eventId))
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .where(gte(schema.oddsSnapshots.takenAt, since))
    .orderBy(desc(schema.oddsSnapshots.takenAt));

  // Need team names correct: do a specialized select (above has alias collision)
  // Re-query teams separately per eventId for efficiency
  const eventIds = Array.from(new Set(rows.map((r) => r.eventId)));
  const eventsMeta = new Map<number, { home: string; away: string; kickoff: Date; competition: string }>();
  if (eventIds.length > 0) {
    const evRows = await db
      .select()
      .from(schema.events)
      .where(gte(schema.events.kickoffUtc, new Date(Date.now() - 6 * 3600 * 1000)));
    const allTeams = await db.select().from(schema.teams);
    const teamName = new Map(allTeams.map((t) => [t.id, t.nameCanonical]));
    const allCompetitions = await db.select().from(schema.competitions);
    const compName = new Map(allCompetitions.map((c) => [c.id, c.name]));
    for (const ev of evRows) {
      eventsMeta.set(ev.id, {
        home: teamName.get(ev.homeTeamId) ?? '?',
        away: teamName.get(ev.awayTeamId) ?? '?',
        kickoff: ev.kickoffUtc,
        competition: compName.get(ev.competitionId) ?? '?',
      });
    }
  }

  // Group per evento+mercato
  type EventMarketKey = string;
  const byEvMkt = new Map<EventMarketKey, {
    eventId: number;
    marketId: number;
    marketName: string;
    latest: DivOdd[];
    history: DivOdd[];
  }>();
  const freshnessMs = 5 * 60_000; // "latest" = snapshot negli ultimi 5 min
  const nowTs = Date.now();
  const latestKeyByBookSel = new Map<string, DivOdd>(); // dedupe per (event, market, book, selection)

  for (const r of rows) {
    const k = `${r.eventId}:${r.marketId}`;
    if (!byEvMkt.has(k)) {
      byEvMkt.set(k, {
        eventId: r.eventId,
        marketId: r.marketId,
        marketName: r.marketName,
        latest: [],
        history: [],
      });
    }
    const entry = byEvMkt.get(k)!;
    const d: DivOdd = {
      bookSlug: r.bookSlug,
      bookTier: classifyTier(r.bookSlug),
      selectionId: r.selectionId,
      selectionSlug: r.selectionSlug,
      odd: r.odd,
      takenAt: r.takenAt,
    };
    entry.history.push(d);
    const dedupKey = `${k}:${r.bookSlug}:${r.selectionId}`;
    if (nowTs - r.takenAt.getTime() <= freshnessMs) {
      const prev = latestKeyByBookSel.get(dedupKey);
      if (!prev || r.takenAt > prev.takenAt) {
        latestKeyByBookSel.set(dedupKey, d);
      }
    }
  }

  // Attach latest filtrato per chiave unique
  for (const [dedupKey, d] of latestKeyByBookSel) {
    const [evId, mktId] = dedupKey.split(':');
    const entry = byEvMkt.get(`${evId}:${mktId}`);
    if (entry) entry.latest.push(d);
  }

  console.log(`  events×markets with recent data: ${byEvMkt.size}`);

  const [admin] = await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  const bankroll = Number(admin?.bankrollEur ?? 500);

  let totalOutlier = 0;
  let totalUnilateral = 0;
  let totalCluster = 0;
  let notified = 0;

  for (const [, entry] of byEvMkt) {
    const meta = eventsMeta.get(entry.eventId);
    if (!meta) continue;

    const outliers = detectOutliers(entry.latest, OUTLIER_Z);
    const unilaterals = detectUnilateralMoves(entry.history, WINDOW_MIN, UNI_PCT);
    const clusters = detectMinorCluster(entry.latest);

    for (const o of outliers) {
      const payload = {
        kind: 'outlier' as const,
        selectionSlug: o.selectionSlug,
        fairOdd: o.crowdMeanOdd,
        fairProb: 1 / o.crowdMeanOdd,
        marketMedianOdd: o.crowdMeanOdd,
        bestBookSlug: o.bookSlug,
        bestBookOdd: o.outlierOdd,
        confidence: Math.min(95, 55 + o.zscore * 10),
        stakeEur: Number((bankroll * 0.01).toFixed(2)),
        bankrollEur: bankroll,
        reasoning: [o.reasoning],
        scores: { sharpEdgeVsSoft: 0, steamScore: 0, minorsEdgeVsSharp: 0, publicMoneyScore: 0 },
        soft: { bookCount: 0, meanOdd: 0, meanImpliedProb: 0 },
        minors: { bookCount: o.bookCount, meanOdd: o.crowdMeanOdd },
        marketName: entry.marketName,
        divergenceType: 'outlier',
      };
      const id = await persistSignalIfNew({
        type: 'bet',
        eventId: entry.eventId,
        marketId: entry.marketId,
        selectionId: entry.latest.find((x) => x.selectionSlug === o.selectionSlug)?.selectionId,
        edge: o.impliedEdgePct / 100,
        payload: payload as unknown as Record<string, unknown>,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      if (id) {
        totalOutlier++;
        if (telegramEnabled() && notified < MAX_TG) {
          const sel = entry.latest.find((x) => x.selectionSlug === o.selectionSlug);
          const ok = await sendTelegram(
            `⚠️ <b>QUOTA PAZZA</b> · outlier ${o.zscore.toFixed(1)}σ\n` +
              `${meta.home} – ${meta.away}\n<i>${entry.marketName}</i>\n\n` +
              `👉 <b>${selectionLabel(o.selectionSlug, meta.home, meta.away)}</b>\n` +
              `<b>${bookLabel(o.bookSlug)}</b> paga <code>${o.outlierOdd.toFixed(2)}</code> ` +
              `(crowd ${o.crowdMeanOdd.toFixed(2)}, +${o.impliedEdgePct.toFixed(1)}%)\n\n` +
              `• ${o.bookCount} altri book convergono su ${o.crowdMeanOdd.toFixed(2)}±${o.crowdStdev.toFixed(2)}\n` +
              `• Z-score ${o.zscore.toFixed(1)} → outlier statistico\n\n` +
              `<a href="${SITE_URL}/signals">Apri</a>`,
          );
          if (ok) notified++;
        }
      }
    }

    for (const u of unilaterals) {
      const dir = u.movementPct < 0 ? '📉' : '📈';
      const id = await persistSignalIfNew({
        type: 'bet',
        eventId: entry.eventId,
        marketId: entry.marketId,
        selectionId: entry.latest.find((x) => x.selectionSlug === u.selectionSlug)?.selectionId,
        edge: Math.abs(u.movementPct) / 100,
        payload: {
          kind: 'unilateral',
          selectionSlug: u.selectionSlug,
          bestBookSlug: u.bookSlug,
          bestBookOdd: u.newOdd,
          marketMedianOdd: u.newOdd,
          fairOdd: u.oldOdd,
          fairProb: 1 / u.oldOdd,
          confidence: Math.min(90, 60 + Math.abs(u.movementPct) * 2),
          stakeEur: Number((bankroll * 0.01).toFixed(2)),
          bankrollEur: bankroll,
          reasoning: [u.reasoning],
          scores: { sharpEdgeVsSoft: 0, steamScore: 1, minorsEdgeVsSharp: 0, publicMoneyScore: 0 },
          soft: { bookCount: 0, meanOdd: 0, meanImpliedProb: 0 },
          minors: { bookCount: 0, meanOdd: 0 },
          marketName: entry.marketName,
          divergenceType: 'unilateral',
        } as unknown as Record<string, unknown>,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      if (id) {
        totalUnilateral++;
        if (telegramEnabled() && notified < MAX_TG) {
          const ok = await sendTelegram(
            `${dir} <b>MOVIMENTO ISOLATO</b>\n` +
              `${meta.home} – ${meta.away}\n<i>${entry.marketName}</i>\n\n` +
              `👉 <b>${selectionLabel(u.selectionSlug, meta.home, meta.away)}</b>\n` +
              `<b>${bookLabel(u.bookSlug)}</b>: ${u.oldOdd.toFixed(2)} → <code>${u.newOdd.toFixed(2)}</code> (${u.movementPct.toFixed(1)}%)\n\n` +
              `• Altri book fermi (max ±${u.othersMovementPct.toFixed(1)}%)\n` +
              `• Informazione asimmetrica / insider\n\n` +
              `<a href="${SITE_URL}/signals">Apri</a>`,
          );
          if (ok) notified++;
        }
      }
    }

    for (const c of clusters) {
      const id = await persistSignalIfNew({
        type: 'bet',
        eventId: entry.eventId,
        marketId: entry.marketId,
        selectionId: entry.latest.find((x) => x.selectionSlug === c.selectionSlug)?.selectionId,
        edge: Math.abs(c.divergencePct) / 100,
        payload: {
          kind: 'minor_cluster',
          selectionSlug: c.selectionSlug,
          bestBookSlug: c.minorBooks[0],
          bestBookOdd: c.minorMeanOdd,
          marketMedianOdd: c.minorMeanOdd,
          fairOdd: c.sharpMeanOdd,
          fairProb: 1 / c.sharpMeanOdd,
          confidence: Math.min(85, 60 + Math.abs(c.divergencePct)),
          stakeEur: Number((bankroll * 0.01).toFixed(2)),
          bankrollEur: bankroll,
          reasoning: [c.reasoning],
          scores: { sharpEdgeVsSoft: 0, steamScore: 0, minorsEdgeVsSharp: Math.abs(c.divergencePct) / 100, publicMoneyScore: 0 },
          soft: { bookCount: 0, meanOdd: 0, meanImpliedProb: 0 },
          minors: { bookCount: c.minorBooks.length, meanOdd: c.minorMeanOdd },
          marketName: entry.marketName,
          divergenceType: 'minor_cluster',
        } as unknown as Record<string, unknown>,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      if (id) {
        totalCluster++;
        if (telegramEnabled() && notified < MAX_TG) {
          const ok = await sendTelegram(
            `🕵️ <b>CLUSTER MINORI</b> · ${c.minorBooks.length} book allineati\n` +
              `${meta.home} – ${meta.away}\n<i>${entry.marketName}</i>\n\n` +
              `👉 <b>${selectionLabel(c.selectionSlug, meta.home, meta.away)}</b>\n` +
              `Minori (${c.minorBooks.map((b) => bookLabel(b)).join(', ')}): <code>${c.minorMeanOdd.toFixed(2)}</code>\n` +
              `Sharp: ${c.sharpMeanOdd.toFixed(2)} (${c.divergencePct >= 0 ? '+' : ''}${c.divergencePct.toFixed(1)}%)\n\n` +
              `• Denaro coordinato tra book minori\n` +
              `• Possibile fixing o flusso informativo locale\n\n` +
              `<a href="${SITE_URL}/signals">Apri</a>`,
          );
          if (ok) notified++;
        }
      }
    }
  }

  console.log(
    `  ✓ outliers=${totalOutlier} unilateral=${totalUnilateral} cluster=${totalCluster} tg=${notified} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
