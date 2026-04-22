/**
 * Filtri anti-falso-positivo per segnali MOVIMENTO LOSCO.
 *
 * 1. Score change: se tra baseline e now il punteggio o i cartellini rossi
 *    sono cambiati, il movimento è spiegato dall'evento in campo → NON losco.
 * 2. Cross-book concordance: se ≥ 40% degli altri book si sono mossi nella
 *    stessa direzione con magnitudo simile, è movimento di mercato → NON losco.
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

export interface MatchStateWindow {
  start: {
    homeGoals: number | null;
    awayGoals: number | null;
    redH: number;
    redA: number;
  } | null;
  end: {
    homeGoals: number | null;
    awayGoals: number | null;
    redH: number;
    redA: number;
  } | null;
}

/** Ritorna gli stati all'inizio e alla fine della finestra per l'evento. */
export async function getMatchStateWindow(
  eventId: number,
  baselineStart: Date,
  now: Date,
): Promise<MatchStateWindow> {
  const rows = await db
    .select()
    .from(schema.eventLiveStates)
    .where(
      and(
        eq(schema.eventLiveStates.eventId, eventId),
        gte(schema.eventLiveStates.takenAt, baselineStart),
        lte(schema.eventLiveStates.takenAt, now),
      ),
    )
    .orderBy(desc(schema.eventLiveStates.takenAt));

  if (rows.length === 0) return { start: null, end: null };
  const end = rows[0];
  const start = rows[rows.length - 1];
  return {
    start: {
      homeGoals: start.homeGoals,
      awayGoals: start.awayGoals,
      redH: start.redCardsHome ?? 0,
      redA: start.redCardsAway ?? 0,
    },
    end: {
      homeGoals: end.homeGoals,
      awayGoals: end.awayGoals,
      redH: end.redCardsHome ?? 0,
      redA: end.redCardsAway ?? 0,
    },
  };
}

export function matchStateChanged(w: MatchStateWindow): { changed: boolean; reason: string } {
  if (!w.start || !w.end) return { changed: false, reason: '' };
  if (w.start.homeGoals !== w.end.homeGoals)
    return { changed: true, reason: `gol casa ${w.start.homeGoals}→${w.end.homeGoals}` };
  if (w.start.awayGoals !== w.end.awayGoals)
    return { changed: true, reason: `gol trasferta ${w.start.awayGoals}→${w.end.awayGoals}` };
  if (w.end.redH > w.start.redH)
    return { changed: true, reason: `cartellino rosso casa` };
  if (w.end.redA > w.start.redA)
    return { changed: true, reason: `cartellino rosso trasferta` };
  return { changed: false, reason: '' };
}

/**
 * Concordance cross-book: quanti degli altri book sullo stesso (event, market,
 * selection) si sono mossi nella stessa direzione con magnitudo >= 50% del
 * target nella stessa finestra.
 *
 * Ritorna frazione [0..1]. Se >= 0.4 → movimento di mercato.
 */
export interface CrossBookInput {
  eventId: number;
  marketId: number;
  selectionId: number;
  targetBookSlug: string;
  windowStart: Date;
  windowEnd: Date;
  targetChangePct: number; // signed, es. -0.06
}

export async function crossBookConcordance(input: CrossBookInput): Promise<{ frac: number; movedBooks: number; totalBooks: number }> {
  const rows = await db
    .select({
      bookSlug: schema.books.slug,
      odd: schema.oddsSnapshots.odd,
      takenAt: schema.oddsSnapshots.takenAt,
    })
    .from(schema.oddsSnapshots)
    .innerJoin(schema.books, eq(schema.books.id, schema.oddsSnapshots.bookId))
    .where(
      and(
        eq(schema.oddsSnapshots.eventId, input.eventId),
        eq(schema.oddsSnapshots.marketId, input.marketId),
        eq(schema.oddsSnapshots.selectionId, input.selectionId),
        gte(schema.oddsSnapshots.takenAt, input.windowStart),
        lte(schema.oddsSnapshots.takenAt, input.windowEnd),
      ),
    );

  const byBook = new Map<string, Array<{ odd: number; takenAt: Date }>>();
  for (const r of rows) {
    if (!byBook.has(r.bookSlug)) byBook.set(r.bookSlug, []);
    byBook.get(r.bookSlug)!.push({ odd: r.odd, takenAt: r.takenAt });
  }

  const direction = Math.sign(input.targetChangePct);
  const thresholdMag = Math.abs(input.targetChangePct) * 0.5;

  let moved = 0;
  let total = 0;
  for (const [slug, arr] of byBook) {
    if (slug === input.targetBookSlug) continue;
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const first = arr[0].odd;
    const last = arr[arr.length - 1].odd;
    if (first <= 0) continue;
    const change = (last - first) / first;
    total++;
    if (Math.sign(change) === direction && Math.abs(change) >= thresholdMag) moved++;
  }

  return {
    frac: total === 0 ? 0 : moved / total,
    movedBooks: moved,
    totalBooks: total,
  };
}
