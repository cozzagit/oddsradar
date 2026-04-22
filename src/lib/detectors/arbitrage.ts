export interface LatestOdd {
  bookId: number;
  bookSlug: string;
  selectionId: number;
  selectionSlug: string;
  odd: number;
  takenAt: Date;
}

export interface ArbitrageResult {
  edge: number;
  legs: Array<{
    bookId: number;
    bookSlug: string;
    selectionId: number;
    selectionSlug: string;
    odd: number;
    stakeShare: number;
  }>;
}

/**
 * Given latest odds per selection per book, find the best arbitrage.
 * Returns null if no arbitrage opportunity exists (sum of 1/max_odd >= 1).
 */
export function detectArbitrage(odds: LatestOdd[]): ArbitrageResult | null {
  if (odds.length === 0) return null;

  const bySelection = new Map<number, LatestOdd>();
  for (const o of odds) {
    const current = bySelection.get(o.selectionId);
    if (!current || o.odd > current.odd) {
      bySelection.set(o.selectionId, o);
    }
  }

  if (bySelection.size < 2) return null;

  const bests = Array.from(bySelection.values());
  const implied = bests.reduce((acc, o) => acc + 1 / o.odd, 0);

  if (implied >= 1) return null;

  const edge = 1 / implied - 1;
  const legs = bests.map((o) => ({
    bookId: o.bookId,
    bookSlug: o.bookSlug,
    selectionId: o.selectionId,
    selectionSlug: o.selectionSlug,
    odd: o.odd,
    stakeShare: 1 / o.odd / implied,
  }));

  return { edge, legs };
}
