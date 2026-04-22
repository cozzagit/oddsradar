/**
 * Live divergence detector — trova "quote pazze" tra i book.
 *
 * 3 segnali:
 *  1. OUTLIER: un book paga > 2.5σ fuori dalla media degli altri
 *     → probabile errore del book o soffiata informativa
 *  2. UNILATERAL_MOVE: un book da solo ha modificato la quota > 10%
 *     negli ultimi N minuti mentre gli altri sono fermi → insider
 *  3. MINOR_CLUSTER: ≥ 3 book minori convergono contro la sharp consensus
 *     con divergenza > 8% → pattern di money laundering / fixing
 */

export interface DivOdd {
  bookSlug: string;
  bookTier: 'sharp' | 'soft' | 'minor' | 'unknown';
  selectionId: number;
  selectionSlug: string;
  odd: number;
  takenAt: Date;
}

export interface OutlierSignal {
  kind: 'outlier';
  bookSlug: string;
  selectionSlug: string;
  outlierOdd: number;
  crowdMeanOdd: number;
  crowdStdev: number;
  zscore: number;
  impliedEdgePct: number;
  bookCount: number;
  reasoning: string;
}

export interface UnilateralSignal {
  kind: 'unilateral';
  bookSlug: string;
  selectionSlug: string;
  oldOdd: number;
  newOdd: number;
  movementPct: number;
  othersMovementPct: number;
  reasoning: string;
}

export interface MinorClusterSignal {
  kind: 'minor_cluster';
  selectionSlug: string;
  minorBooks: string[];
  minorMeanOdd: number;
  sharpMeanOdd: number;
  divergencePct: number;
  reasoning: string;
}

export type DivergenceSignal = OutlierSignal | UnilateralSignal | MinorClusterSignal;

const SHARP_SLUGS = new Set(['pinnacle', 'betfair_ex', 'smarkets', 'matchbook', 'sbobet']);
const MINOR_SLUGS = new Set([
  '1xbet', 'mozzart', 'meridianbet', 'superbet', 'betano', 'fonbet',
  'parimatch', 'sportybet', '188bet', 'dafabet', 'api_football_live',
  'interwetten',
]);

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function meanStdev(a: number[]): { mean: number; stdev: number } {
  if (a.length === 0) return { mean: 0, stdev: 0 };
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const variance = a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length;
  return { mean, stdev: Math.sqrt(variance) };
}

/**
 * OUTLIER detector: trova book con quota > zthreshold σ fuori dalla crowd.
 * Richiede ≥ 5 book sulla stessa selection per essere affidabile.
 */
export function detectOutliers(latest: DivOdd[], zThreshold = 2.5): OutlierSignal[] {
  const bySel = new Map<number, DivOdd[]>();
  for (const o of latest) {
    if (!bySel.has(o.selectionId)) bySel.set(o.selectionId, []);
    bySel.get(o.selectionId)!.push(o);
  }

  const out: OutlierSignal[] = [];
  for (const [, odds] of bySel) {
    if (odds.length < 5) continue;
    // Per ogni book, calcola z vs gli altri
    for (const target of odds) {
      const others = odds.filter((o) => o.bookSlug !== target.bookSlug);
      if (others.length < 4) continue;
      const { mean, stdev } = meanStdev(others.map((o) => o.odd));
      if (stdev === 0) continue;
      const z = (target.odd - mean) / stdev;
      if (Math.abs(z) < zThreshold) continue;
      const impliedEdge = target.odd / mean - 1;
      // Solo segnale se book paga DI PIÙ (z>0) — le quote sotto la media sono
      // scarsamente azionabili per il nostro caso (paga meno = valore peggiore).
      if (z < 0) continue;
      out.push({
        kind: 'outlier',
        bookSlug: target.bookSlug,
        selectionSlug: target.selectionSlug,
        outlierOdd: target.odd,
        crowdMeanOdd: mean,
        crowdStdev: stdev,
        zscore: z,
        impliedEdgePct: impliedEdge * 100,
        bookCount: others.length,
        reasoning:
          `${target.bookSlug} paga ${target.odd.toFixed(2)}, ` +
          `la media degli altri ${others.length} book è ${mean.toFixed(2)} (±${stdev.toFixed(2)}). ` +
          `Z-score ${z.toFixed(1)} → outlier statistico (${(impliedEdge * 100).toFixed(1)}% sopra il mercato).`,
      });
    }
  }
  return out.sort((a, b) => b.zscore - a.zscore);
}

/**
 * UNILATERAL MOVE: un book si è mosso, gli altri no.
 * Richiede storia di ≥ 10 min per almeno 3 book.
 */
export function detectUnilateralMoves(
  history: DivOdd[],
  windowMinutes = 15,
  unilateralPct = 0.08,
  othersMaxMovePct = 0.025,
): UnilateralSignal[] {
  const windowMs = windowMinutes * 60_000;
  const now = Date.now();
  const bySelBook = new Map<string, DivOdd[]>();
  for (const p of history) {
    if (now - p.takenAt.getTime() > windowMs) continue;
    const k = `${p.selectionId}:${p.bookSlug}`;
    if (!bySelBook.has(k)) bySelBook.set(k, []);
    bySelBook.get(k)!.push(p);
  }

  // Per ogni selection, calcola movimento di ciascun book
  const bySel = new Map<number, Map<string, { oldOdd: number; newOdd: number; movePct: number; selectionSlug: string }>>();
  for (const [k, points] of bySelBook) {
    if (points.length < 2) continue;
    const [selIdStr, bookSlug] = k.split(':');
    const selId = Number(selIdStr);
    points.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const first = points[0];
    const last = points[points.length - 1];
    const move = (last.odd - first.odd) / first.odd;
    if (!bySel.has(selId)) bySel.set(selId, new Map());
    bySel.get(selId)!.set(bookSlug, {
      oldOdd: first.odd,
      newOdd: last.odd,
      movePct: move,
      selectionSlug: last.selectionSlug,
    });
  }

  const out: UnilateralSignal[] = [];
  for (const [, bookMoves] of bySel) {
    if (bookMoves.size < 3) continue;
    const allMoves = [...bookMoves.entries()];
    for (const [bookSlug, info] of allMoves) {
      if (Math.abs(info.movePct) < unilateralPct) continue;
      const others = allMoves.filter(([b]) => b !== bookSlug).map(([, i]) => i.movePct);
      const othersMaxMove = Math.max(...others.map((m) => Math.abs(m)));
      if (othersMaxMove > othersMaxMovePct) continue;
      const direction = info.movePct < 0 ? 'scesa' : 'salita';
      out.push({
        kind: 'unilateral',
        bookSlug,
        selectionSlug: info.selectionSlug,
        oldOdd: info.oldOdd,
        newOdd: info.newOdd,
        movementPct: info.movePct * 100,
        othersMovementPct: othersMaxMove * 100,
        reasoning:
          `${bookSlug}: quota ${direction} da ${info.oldOdd.toFixed(2)} a ${info.newOdd.toFixed(2)} ` +
          `(${(info.movePct * 100).toFixed(1)}%) in ${windowMinutes}min, mentre gli altri book si sono mossi al massimo ±${(othersMaxMove * 100).toFixed(1)}%. ` +
          `Movimento unilaterale: segnale di informazione asimmetrica.`,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.movementPct) - Math.abs(a.movementPct));
}

/**
 * MINOR CLUSTER: ≥ 3 book minori convergono tutti contro la sharp consensus.
 */
export function detectMinorCluster(latest: DivOdd[], divergencePct = 0.08): MinorClusterSignal[] {
  const bySel = new Map<number, DivOdd[]>();
  for (const o of latest) {
    if (!bySel.has(o.selectionId)) bySel.set(o.selectionId, []);
    bySel.get(o.selectionId)!.push(o);
  }

  const out: MinorClusterSignal[] = [];
  for (const [, odds] of bySel) {
    const sharp = odds.filter((o) => SHARP_SLUGS.has(o.bookSlug));
    const minor = odds.filter((o) => MINOR_SLUGS.has(o.bookSlug));
    if (sharp.length < 2 || minor.length < 3) continue;
    const sharpMean = sharp.reduce((a, b) => a + b.odd, 0) / sharp.length;
    const minorMean = minor.reduce((a, b) => a + b.odd, 0) / minor.length;
    const divergence = (minorMean - sharpMean) / sharpMean;
    if (Math.abs(divergence) < divergencePct) continue;
    // Per convergenza vera, serve anche che la stdev dei minori sia bassa (sono allineati tra loro)
    const minorStdev = Math.sqrt(
      minor.reduce((a, b) => a + (b.odd - minorMean) ** 2, 0) / minor.length,
    );
    const coefVar = minorStdev / minorMean;
    if (coefVar > 0.05) continue; // minori dispersi tra loro, non un vero cluster

    const direction = divergence > 0 ? 'sopra' : 'sotto';
    out.push({
      kind: 'minor_cluster',
      selectionSlug: minor[0].selectionSlug,
      minorBooks: minor.map((m) => m.bookSlug),
      minorMeanOdd: minorMean,
      sharpMeanOdd: sharpMean,
      divergencePct: divergence * 100,
      reasoning:
        `${minor.length} book minori (${minor.map((m) => m.bookSlug).join(', ')}) ` +
        `convergono su quota media ${minorMean.toFixed(2)}, ` +
        `${Math.abs(divergence * 100).toFixed(1)}% ${direction} degli sharp (${sharpMean.toFixed(2)}). ` +
        `Possibile segnale di denaro coordinato su quel mercato.`,
    });
  }
  return out.sort((a, b) => Math.abs(b.divergencePct) - Math.abs(a.divergencePct));
}
