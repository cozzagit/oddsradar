/**
 * PRICE-CHANGE detector — self-comparison temporale per book.
 *
 * Per ogni tripla (book, evento+mercato, selezione) guardo la storia delle
 * ultime N ore e confronto l'ultima quota con la media o mediana del periodo
 * precedente. Se il movimento supera la soglia, genera segnale.
 *
 * Focus: variazione improvvisa sulla STESSA quota, non confronto tra book.
 */

export interface TimedOdd {
  takenAt: Date;
  bookSlug: string;
  selectionId: number;
  selectionSlug: string;
  odd: number;
}

export interface PriceChangeSignal {
  bookSlug: string;
  selectionId: number;
  selectionSlug: string;
  previousOdd: number;      // baseline (mediana della storia precedente)
  currentOdd: number;       // ultima quota
  changePct: number;        // variazione decimale (es. -0.06 = -6%)
  direction: 'drop' | 'rise';
  samplesOld: number;
  ageMinutesOld: number;    // quanti min fa era la baseline
  recentSamples: number;    // quanti snapshot nel periodo recente
  reasoning: string;
}

/**
 * Minima freshness: l'ultima quota deve essere più recente di `maxAgeMinutes`.
 * Baseline: mediana delle quote nel periodo [now - baselineWindowMinutes, now - recencyMinutes].
 * Recente: mediana delle quote negli ultimi `recencyMinutes`.
 * Change = recentMedian / baselineMedian - 1
 */
export function detectPriceChanges(
  history: TimedOdd[],
  opts: {
    thresholdPct?: number;       // default 0.04 (4%)
    baselineWindowMinutes?: number; // default 60
    recencyMinutes?: number;     // default 5
    minBaselineSamples?: number; // default 3
    minRecentSamples?: number;   // default 1
    maxAgeMinutes?: number;      // default 10 (l'ultima quota deve essere recente)
  } = {},
): PriceChangeSignal[] {
  const threshold = opts.thresholdPct ?? 0.04;
  const baselineWindow = (opts.baselineWindowMinutes ?? 60) * 60_000;
  const recency = (opts.recencyMinutes ?? 5) * 60_000;
  const minBase = opts.minBaselineSamples ?? 3;
  const minRec = opts.minRecentSamples ?? 1;
  const maxAge = (opts.maxAgeMinutes ?? 10) * 60_000;

  const now = Date.now();
  const recencyCutoff = now - recency;
  const baselineCutoff = now - baselineWindow;

  // Group per (bookSlug, selectionId)
  const byKey = new Map<string, TimedOdd[]>();
  for (const p of history) {
    const k = `${p.bookSlug}|${p.selectionId}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }

  const signals: PriceChangeSignal[] = [];

  for (const [, arr] of byKey) {
    arr.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const last = arr[arr.length - 1];
    if (now - last.takenAt.getTime() > maxAge) continue;

    const recentPts = arr.filter((p) => p.takenAt.getTime() >= recencyCutoff);
    const basePts = arr.filter(
      (p) => p.takenAt.getTime() < recencyCutoff && p.takenAt.getTime() >= baselineCutoff,
    );
    if (recentPts.length < minRec || basePts.length < minBase) continue;

    const recentMedian = median(recentPts.map((p) => p.odd));
    const baseMedian = median(basePts.map((p) => p.odd));
    if (baseMedian <= 0) continue;

    const change = recentMedian / baseMedian - 1;
    if (Math.abs(change) < threshold) continue;

    const ageOfBaseline = (now - basePts[basePts.length - 1].takenAt.getTime()) / 60_000;

    signals.push({
      bookSlug: last.bookSlug,
      selectionId: last.selectionId,
      selectionSlug: last.selectionSlug,
      previousOdd: baseMedian,
      currentOdd: recentMedian,
      changePct: change,
      direction: change < 0 ? 'drop' : 'rise',
      samplesOld: basePts.length,
      ageMinutesOld: Math.round(ageOfBaseline),
      recentSamples: recentPts.length,
      reasoning:
        `${last.bookSlug}: quota ${change < 0 ? 'scesa' : 'salita'} da ` +
        `${baseMedian.toFixed(2)} (${basePts.length} snapshot negli ultimi ~${Math.round(ageOfBaseline)}min) ` +
        `a ${recentMedian.toFixed(2)} (${recentPts.length} snapshot ultimi ${opts.recencyMinutes ?? 5}min). ` +
        `Variazione ${(change * 100).toFixed(1)}%.`,
    });
  }

  return signals.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
