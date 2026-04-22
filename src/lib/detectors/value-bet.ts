import type { LatestOdd } from './arbitrage';

export interface ValueBetResult {
  bookId: number;
  bookSlug: string;
  selectionId: number;
  selectionSlug: string;
  offeredOdd: number;
  fairOdd: number;
  fairProb: number;
  edge: number;
}

/**
 * Compute fair probability from sharp consensus (Pinnacle + Betfair Exchange + Smarkets).
 * Removes overround proportionally. Returns probability per selectionId.
 */
export function fairProbabilitiesFromSharp(
  sharpOdds: LatestOdd[],
  sharpBookSlugs: string[] = ['pinnacle', 'betfair_ex', 'smarkets'],
): Map<number, number> {
  const byBook = new Map<string, LatestOdd[]>();
  for (const o of sharpOdds) {
    if (!sharpBookSlugs.includes(o.bookSlug)) continue;
    if (!byBook.has(o.bookSlug)) byBook.set(o.bookSlug, []);
    byBook.get(o.bookSlug)!.push(o);
  }

  const bookFairProbs: Map<number, number[]> = new Map();
  for (const [, bookOdds] of byBook) {
    const implied = bookOdds.reduce((acc, o) => acc + 1 / o.odd, 0);
    if (implied <= 0) continue;
    for (const o of bookOdds) {
      const fair = 1 / o.odd / implied;
      if (!bookFairProbs.has(o.selectionId)) bookFairProbs.set(o.selectionId, []);
      bookFairProbs.get(o.selectionId)!.push(fair);
    }
  }

  const consensus = new Map<number, number>();
  for (const [selId, probs] of bookFairProbs) {
    consensus.set(selId, probs.reduce((a, b) => a + b, 0) / probs.length);
  }
  return consensus;
}

export function detectValueBets(
  allOdds: LatestOdd[],
  sharpOdds: LatestOdd[],
  edgeMin = 0.03,
): ValueBetResult[] {
  const fair = fairProbabilitiesFromSharp(sharpOdds);
  if (fair.size === 0) return [];

  const results: ValueBetResult[] = [];
  for (const o of allOdds) {
    const p = fair.get(o.selectionId);
    if (!p) continue;
    const edge = o.odd * p - 1;
    if (edge < edgeMin) continue;
    results.push({
      bookId: o.bookId,
      bookSlug: o.bookSlug,
      selectionId: o.selectionId,
      selectionSlug: o.selectionSlug,
      offeredOdd: o.odd,
      fairOdd: 1 / p,
      fairProb: p,
      edge,
    });
  }
  return results.sort((a, b) => b.edge - a.edge);
}
