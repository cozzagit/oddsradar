/**
 * BestBetDetector — fonde 4 segnali sul mercato per dare 1 raccomandazione
 * per evento+mercato con confidence score 0-100.
 *
 * Input: tutti i `LatestOdd` dei book per lo stesso market dell'evento,
 * divisi per selection. Plus (opzionale) uno storico di odds negli ultimi
 * N minuti per lo steam detector.
 *
 * Output: per ogni selection, un BestBetRecommendation. Il caller tiene solo
 * quella top.
 */

import type { LatestOdd } from './arbitrage';

export interface OddsHistoryPoint {
  bookSlug: string;
  selectionId: number;
  odd: number;
  takenAt: Date;
}

export interface BestBetRecommendation {
  selectionId: number;
  selectionSlug: string;
  fairProb: number;            // probabilità reale stimata (0-1) da sharp consensus
  fairOdd: number;
  marketMedianOdd: number;     // mediana del mercato (tutti i book)
  bestBookSlug: string;        // book che paga di più
  bestBookOdd: number;         // quota del miglior book
  soft: {                      // soft consensus (Snai/Goldbet/Sisal/Eurobet/Bet365/Unibet)
    bookCount: number;
    meanOdd: number;
    meanImpliedProb: number;
  };
  minors: {                    // book minori internazionali
    bookCount: number;
    meanOdd: number;
  };
  scores: {
    sharpEdgeVsSoft: number;   // +% che gli sharp pagano meno (→ soft è in ritardo)
    steamScore: number;        // 0-1 — quota calata su più book nei N min
    minorsEdgeVsSharp: number; // +% che i minori pagano di più (anomalia)
    publicMoneyScore: number;  // 0-1 placeholder, riservato per Sprint 4
  };
  confidence: number;          // 0-100 punteggio combinato
  edge: number;                // edge% principale (max tra sharpEdgeVsSoft, minorsEdgeVsSharp) per sort
  reasoning: string[];         // bullet points in italiano
}

const SHARP = new Set(['pinnacle', 'betfair_ex', 'smarkets', 'matchbook']);
const SOFT = new Set(['snai', 'goldbet', 'sisal', 'eurobet', 'bet365', 'unibet', 'williamhill', 'bwin']);
const MINORS = new Set([
  '1xbet', 'sbobet', '188bet', 'dafabet', 'fonbet', 'parimatch',
  'mozzart', 'meridianbet', 'superbet', 'betano', 'sportybet',
]);

/**
 * Multiplicative devigging per book.
 * IMPORTANTE: un book è usato SOLO se copre tutte le `expectedSelections`
 * del mercato (per O/U serve 2, per 1X2 serve 3). Altrimenti il sum of
 * implied è < 1 e la fair prob esce gonfiata (bug visto in produzione:
 * fair=0.48 con quota 4.52 → edge 118%).
 */
function stripVig(odds: LatestOdd[], expectedSelections: number): Map<number, number> {
  const byBook = new Map<string, LatestOdd[]>();
  for (const o of odds) {
    if (!byBook.has(o.bookSlug)) byBook.set(o.bookSlug, []);
    byBook.get(o.bookSlug)!.push(o);
  }
  const bookFair: Map<number, number[]> = new Map();
  for (const [, bookOdds] of byBook) {
    if (bookOdds.length < expectedSelections) continue; // skip book incompleti
    const impliedSum = bookOdds.reduce((acc, o) => acc + 1 / o.odd, 0);
    // sanity: sum dovrebbe essere > 1.0 (vig positivo). Scarto se outlier.
    if (impliedSum < 0.95 || impliedSum > 1.25) continue;
    for (const o of bookOdds) {
      const fair = 1 / o.odd / impliedSum;
      if (!bookFair.has(o.selectionId)) bookFair.set(o.selectionId, []);
      bookFair.get(o.selectionId)!.push(fair);
    }
  }
  const mean = new Map<number, number>();
  for (const [selId, arr] of bookFair) {
    mean.set(selId, arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  return mean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

function selectionsOf(odds: LatestOdd[]): Map<number, { slug: string; byBook: Map<string, LatestOdd> }> {
  const out = new Map<number, { slug: string; byBook: Map<string, LatestOdd> }>();
  for (const o of odds) {
    if (!out.has(o.selectionId)) out.set(o.selectionId, { slug: o.selectionSlug, byBook: new Map() });
    out.get(o.selectionId)!.byBook.set(o.bookSlug, o);
  }
  return out;
}

/** Compute steam score 0..1 per selection: share of books whose odd decreased > 1% in window. */
function steamScoresFor(history: OddsHistoryPoint[] | undefined, windowMin = 10): Map<number, number> {
  const scores = new Map<number, number>();
  if (!history || history.length === 0) return scores;
  const now = Date.now();
  const windowMs = windowMin * 60_000;

  // Group by (book, selection)
  const byKey = new Map<string, OddsHistoryPoint[]>();
  for (const p of history) {
    const k = `${p.bookSlug}:${p.selectionId}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }
  const dropsBySelection = new Map<number, { drops: number; total: number }>();
  for (const [key, pts] of byKey) {
    const [, selIdStr] = key.split(':');
    const selId = Number(selIdStr);
    pts.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const inWindow = pts.filter((p) => now - p.takenAt.getTime() <= windowMs);
    if (inWindow.length < 2) continue;
    const first = inWindow[0].odd;
    const last = inWindow[inWindow.length - 1].odd;
    const dropPct = (first - last) / first;
    const stats = dropsBySelection.get(selId) ?? { drops: 0, total: 0 };
    stats.total += 1;
    if (dropPct > 0.01) stats.drops += 1;
    dropsBySelection.set(selId, stats);
  }
  for (const [selId, s] of dropsBySelection) {
    scores.set(selId, s.total > 0 ? s.drops / s.total : 0);
  }
  return scores;
}

export function detectBestBets(
  allOdds: LatestOdd[],
  history?: OddsHistoryPoint[],
): BestBetRecommendation[] {
  if (allOdds.length < 3) return [];

  // Determina numero atteso di selezioni del mercato dai dati stessi.
  const sels = selectionsOf(allOdds);
  const expectedSelections = sels.size;
  if (expectedSelections < 2) return [];

  const fairAll = stripVig(allOdds, expectedSelections);
  const sharpOdds = allOdds.filter((o) => SHARP.has(o.bookSlug));
  // Serve almeno 1 book sharp COMPLETO per fair affidabile.
  const sharpBookCount = new Set(sharpOdds.map((o) => o.bookSlug)).size;
  if (sharpBookCount < 1) return [];
  const fairSharp = stripVig(sharpOdds, expectedSelections);
  if (fairSharp.size === 0) return []; // nessun book sharp completo

  const steam = steamScoresFor(history);
  const results: BestBetRecommendation[] = [];

  for (const [selId, sel] of sels) {
    const fair = fairSharp.get(selId) ?? fairAll.get(selId);
    if (!fair || fair <= 0 || fair >= 1) continue;
    const fairOdd = 1 / fair;

    const bookOdds = [...sel.byBook.values()];
    const marketMedian = median(bookOdds.map((o) => o.odd));

    let bestBookSlug = '';
    let bestBookOdd = 0;
    for (const o of bookOdds) {
      if (o.odd > bestBookOdd) {
        bestBookOdd = o.odd;
        bestBookSlug = o.bookSlug;
      }
    }

    const softOdds = bookOdds.filter((o) => SOFT.has(o.bookSlug));
    const softMean = softOdds.length > 0 ? softOdds.reduce((a, b) => a + b.odd, 0) / softOdds.length : 0;
    const softImplied = softMean > 0 ? 1 / softMean : 0;

    const minorOdds = bookOdds.filter((o) => MINORS.has(o.bookSlug));
    const minorMean = minorOdds.length > 0 ? minorOdds.reduce((a, b) => a + b.odd, 0) / minorOdds.length : 0;

    // Sharp edge vs soft: almeno 2 soft per ridurre varianza.
    // Cap edge a 20% per tagliare outlier/bug.
    let sharpEdgeVsSoft = 0;
    if (softOdds.length >= 2 && softMean > 0) {
      const raw = softMean * fair - 1;
      sharpEdgeVsSoft = Math.max(-0.2, Math.min(0.2, raw));
    }

    // Minors edge vs sharp: minori pagano molto di più dello sharp → anomalia sospetta
    const sharpOnSel = sharpOdds.filter((o) => o.selectionId === selId);
    const sharpMeanSel = sharpOnSel.length > 0
      ? sharpOnSel.reduce((a, b) => a + b.odd, 0) / sharpOnSel.length
      : 0;
    let minorsEdgeVsSharp = 0;
    if (minorOdds.length >= 3 && sharpMeanSel > 0 && minorMean > 0) {
      const raw = (minorMean - sharpMeanSel) / sharpMeanSel;
      minorsEdgeVsSharp = Math.max(-0.2, Math.min(0.2, raw));
    }

    const steamScore = steam.get(selId) ?? 0;

    // Confidence 0-100
    let confidence = 0;
    const reasoning: string[] = [];

    // 1) Fair prob elevata → base confidence
    confidence += Math.min(40, fair * 80);
    reasoning.push(
      `Probabilità reale stimata: <b>${(fair * 100).toFixed(1)}%</b> (${sharpBookCount} sharp book).`,
    );

    // 2) Soft in ritardo (vantaggio)
    if (sharpEdgeVsSoft > 0.015 && softOdds.length >= 2) {
      const bonus = Math.min(25, sharpEdgeVsSoft * 200);
      confidence += bonus;
      reasoning.push(
        `Soft book (Snai/Goldbet/Sisal/Bet365) pagano in media ${softMean.toFixed(2)}, più del valore reale ${fairOdd.toFixed(2)} (+${(sharpEdgeVsSoft * 100).toFixed(1)}%).`,
      );
    }

    // 3) Steam
    if (steamScore > 0.3) {
      confidence += Math.min(20, steamScore * 25);
      reasoning.push(
        `Steam: ${Math.round(steamScore * 100)}% dei book hanno abbassato la quota negli ultimi 10 min (smart money in entrata).`,
      );
    }

    // 4) Minori convergenti verso alto (anomalia)
    if (minorsEdgeVsSharp > 0.04 && minorOdds.length >= 3) {
      confidence += Math.min(15, minorsEdgeVsSharp * 100);
      reasoning.push(
        `${minorOdds.length} book minori (Mozzart/1xBet/SBOBet/Fonbet) convergono su quota ${minorMean.toFixed(2)}, ${(minorsEdgeVsSharp * 100).toFixed(1)}% sopra gli sharp.`,
      );
    }

    confidence = Math.max(0, Math.min(100, confidence));
    const edge = Math.max(sharpEdgeVsSoft, minorsEdgeVsSharp, 0);

    results.push({
      selectionId: selId,
      selectionSlug: sel.slug,
      fairProb: fair,
      fairOdd,
      marketMedianOdd: marketMedian,
      bestBookSlug,
      bestBookOdd,
      soft: { bookCount: softOdds.length, meanOdd: softMean, meanImpliedProb: softImplied },
      minors: { bookCount: minorOdds.length, meanOdd: minorMean },
      scores: {
        sharpEdgeVsSoft,
        steamScore,
        minorsEdgeVsSharp,
        publicMoneyScore: 0,
      },
      confidence,
      edge,
      reasoning,
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/** Kelly frazionato 1/4, cap 5% bankroll. */
export function suggestStakeEur(bankrollEur: number, fairProb: number, offeredOdd: number): number {
  if (offeredOdd <= 1 || fairProb <= 0 || fairProb >= 1) return 0;
  const kelly = (offeredOdd * fairProb - 1) / (offeredOdd - 1);
  const frac = Math.max(0, Math.min(0.05, kelly / 4));
  return Number((bankrollEur * frac).toFixed(2));
}
