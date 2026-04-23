/**
 * Volume-flow scanner — cerca surge di volume matched su Polymarket/
 * Betfair Exchange per rilevare denaro reale che entra su un outcome.
 *
 * Esegui periodicamente (ogni 3-5 min). Genera signal type='bet' con
 * payload.kind='volume_flow' e label Telegram "💰 FLUSSO DENARO".
 */
import 'dotenv/config';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import { detectVolumeFlow } from '../src/lib/detectors/volume-flow';
import { persistSignalIfNew, expireOldSignals } from '../src/lib/signals/persist';
import { bookLabel, selectionLabel } from '../src/lib/signals/actionable';
import { sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';
import { isNotificationsEnabled } from '../src/lib/settings';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const MAX_TG = Number(process.env.MAX_TELEGRAM_PER_RUN ?? '5');
const WINDOW_MIN = Number(process.env.VOLUME_WINDOW_MIN ?? '30');
const GROWTH_PCT = Number(process.env.VOLUME_GROWTH_PCT ?? '0.3');
const MIN_ODD_CHANGE = Number(process.env.VOLUME_MIN_ODD_CHANGE ?? '0.02');

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === VOLUME-FLOW scan ===`);
  if (!(await isNotificationsEnabled())) {
    console.log('  ⏸ notifications paused — skip');
    return;
  }
  await expireOldSignals();

  const since = new Date(Date.now() - WINDOW_MIN * 60_000);

  // Pulla storia volume per selection (ultimi N min)
  const rows = await db
    .select({
      eventId: schema.volumesSnapshots.eventId,
      marketId: schema.volumesSnapshots.marketId,
      marketName: schema.markets.name,
      selectionId: schema.volumesSnapshots.selectionId,
      selectionSlug: schema.selections.slug,
      bookSlug: schema.books.slug,
      takenAt: schema.volumesSnapshots.takenAt,
      matchedVolume: schema.volumesSnapshots.matchedVolume,
    })
    .from(schema.volumesSnapshots)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.volumesSnapshots.marketId))
    .innerJoin(schema.selections, eq(schema.selections.id, schema.volumesSnapshots.selectionId))
    .innerJoin(schema.books, eq(schema.books.id, schema.volumesSnapshots.bookId))
    .where(gte(schema.volumesSnapshots.takenAt, since));

  console.log(`  volume samples: ${rows.length}`);
  if (rows.length === 0) {
    console.log('  no volume data yet, skip');
    return;
  }

  // Join con odds_snapshots per ottenere la quota corrispondente
  type SelKey = string;
  const series = new Map<
    SelKey,
    {
      eventId: number;
      marketId: number;
      marketName: string;
      selectionId: number;
      selectionSlug: string;
      bookSlug: string;
      samples: Array<{ takenAt: Date; volume: number | null; odd: number }>;
    }
  >();

  // Preload odds for same window
  const oddsRows = await db
    .select({
      eventId: schema.oddsSnapshots.eventId,
      marketId: schema.oddsSnapshots.marketId,
      selectionId: schema.oddsSnapshots.selectionId,
      bookId: schema.oddsSnapshots.bookId,
      takenAt: schema.oddsSnapshots.takenAt,
      odd: schema.oddsSnapshots.odd,
    })
    .from(schema.oddsSnapshots)
    .where(gte(schema.oddsSnapshots.takenAt, since));

  const bookSlugById = new Map(
    (await db.select().from(schema.books)).map((b) => [b.id, b.slug]),
  );

  // Map (ev, mkt, sel, bookSlug, timeBucket) → odd
  const oddIndex = new Map<string, number>();
  for (const o of oddsRows) {
    const slug = bookSlugById.get(o.bookId) ?? '';
    const bucket = Math.round(o.takenAt.getTime() / 30_000); // 30s buckets
    const k = `${o.eventId}:${o.marketId}:${o.selectionId}:${slug}:${bucket}`;
    oddIndex.set(k, o.odd);
  }

  for (const r of rows) {
    const key = `${r.eventId}:${r.marketId}:${r.selectionId}:${r.bookSlug}`;
    if (!series.has(key)) {
      series.set(key, {
        eventId: r.eventId,
        marketId: r.marketId,
        marketName: r.marketName,
        selectionId: r.selectionId,
        selectionSlug: r.selectionSlug,
        bookSlug: r.bookSlug,
        samples: [],
      });
    }
    const bucket = Math.round(r.takenAt.getTime() / 30_000);
    const k = `${r.eventId}:${r.marketId}:${r.selectionId}:${r.bookSlug}:${bucket}`;
    const odd = oddIndex.get(k) ?? oddIndex.get(`${r.eventId}:${r.marketId}:${r.selectionId}:${r.bookSlug}:${bucket - 1}`);
    if (!odd) continue;
    series.get(key)!.samples.push({ takenAt: r.takenAt, volume: r.matchedVolume, odd });
  }

  console.log(`  series: ${series.size}`);

  // Event meta
  const touched = Array.from(series.values()).map((s) => s.eventId);
  const eventIds = Array.from(new Set(touched));
  const eventMeta = new Map<number, { home: string; away: string; kickoff: Date; competition: string }>();
  if (eventIds.length > 0) {
    const evRows = await db.select().from(schema.events).where(inArray(schema.events.id, eventIds));
    const allTeams = await db.select().from(schema.teams);
    const teamName = new Map(allTeams.map((t) => [t.id, t.nameCanonical]));
    const allComp = await db.select().from(schema.competitions);
    const compName = new Map(allComp.map((c) => [c.id, c.name]));
    for (const ev of evRows) {
      eventMeta.set(ev.id, {
        home: teamName.get(ev.homeTeamId) ?? '?',
        away: teamName.get(ev.awayTeamId) ?? '?',
        kickoff: ev.kickoffUtc,
        competition: compName.get(ev.competitionId) ?? '?',
      });
    }
  }

  const [admin] = await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  const bankroll = Number(admin?.bankrollEur ?? 500);

  let persisted = 0;
  let notified = 0;

  for (const [, s] of series) {
    if (s.samples.length < 3) continue;
    const flow = detectVolumeFlow(
      { selectionId: s.selectionId, selectionSlug: s.selectionSlug, history: s.samples },
      { baselineWindowMin: WINDOW_MIN, recencyWindowMin: 5, volumeGrowthThreshold: GROWTH_PCT, minOddChange: MIN_ODD_CHANGE },
    );
    if (!flow) continue;
    // Preferiamo money_in (denaro che ENTRA = segnale azionabile)
    if (flow.direction !== 'money_in') continue;

    const meta = eventMeta.get(s.eventId);
    if (!meta) continue;
    // Skip se evento già passato
    if (meta.kickoff.getTime() < Date.now() - 30 * 60_000) continue;

    const payload = {
      kind: 'volume_flow',
      selectionSlug: s.selectionSlug,
      bookSlug: s.bookSlug,
      bestBookSlug: s.bookSlug,
      bestBookOdd: flow.newestOdd,
      marketMedianOdd: flow.newestOdd,
      fairOdd: flow.oldestOdd,
      fairProb: 1 / flow.newestOdd,
      confidence: Math.min(90, 55 + flow.volumeGrowthPct * 40),
      stakeEur: Number((bankroll * 0.01).toFixed(2)),
      bankrollEur: bankroll,
      reasoning: [flow.reasoning],
      scores: { sharpEdgeVsSoft: 0, steamScore: 0, minorsEdgeVsSharp: 0, publicMoneyScore: Math.min(1, flow.volumeGrowthPct) },
      soft: { bookCount: 0, meanOdd: 0, meanImpliedProb: 0 },
      minors: { bookCount: 0, meanOdd: 0 },
      marketName: s.marketName,
      volumeBaseline: flow.baselineVolume,
      volumeRecent: flow.recentVolume,
      volumeGrowthPct: flow.volumeGrowthPct,
      oddChange: flow.oddChangePct,
    };

    const id = await persistSignalIfNew({
      type: 'bet',
      eventId: s.eventId,
      marketId: s.marketId,
      selectionId: s.selectionId,
      edge: Math.abs(flow.oddChangePct),
      payload: payload as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + 20 * 60_000),
      dedupWindowMs: 45 * 60_000,
    });
    if (!id) continue;
    persisted++;

    if (telegramEnabled() && notified < MAX_TG) {
      const kickoffShort = meta.kickoff.toLocaleString('it-IT', {
        weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome',
      });
      const text =
        `💰 <b>FLUSSO DENARO</b> +${(flow.volumeGrowthPct * 100).toFixed(0)}%\n` +
        `${meta.home} – ${meta.away}\n` +
        `<i>${meta.competition} · ${s.marketName} · ${kickoffShort}</i>\n\n` +
        `👉 <b>${selectionLabel(s.selectionSlug, meta.home, meta.away)}</b> su <b>${bookLabel(s.bookSlug)}</b>\n` +
        `Quota: <code>${flow.oldestOdd.toFixed(2)}</code> → <code>${flow.newestOdd.toFixed(2)}</code> (${(flow.oddChangePct * 100).toFixed(1)}%)\n\n` +
        `Volume matched: ${flow.baselineVolume.toFixed(0)} → <b>${flow.recentVolume.toFixed(0)}</b>\n` +
        `<i>Scommettitori reali stanno puntando su questo esito</i>\n\n` +
        `<a href="${SITE_URL}/signals">Apri</a>`;
      const ok = await sendTelegram(text);
      if (ok) notified++;
    }
  }

  console.log(`  ✓ volume_flow=${persisted} tg=${notified} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
