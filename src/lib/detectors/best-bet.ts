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
  const sharpBookCount = new Set(sharpOdds.map((o) => o.bookSlug)).size;
  // Serve almeno 1 sharp completo. Se 2+ usiamo media sharp, se 1 solo pooliamo
  // sharp+soft mainstream per ridurre rischio outlier del singolo book.
  const fairSharp = sharpBookCount >= 1 ? stripVig(sharpOdds, expectedSelections) : new Map<number, number>();
  const fairUsed = fairSharp.size > 0 ? fairSharp : fairAll;
  if (fairUsed.size === 0) return [];

  // SANITY: fair_prob vs implied del market median, max delta 10 punti.
  // Evita soliti bug di devigging che facevano fair=0.53 con quota mercato=2.34.
  const sanityMaxDelta = 0.1;

  const steam = steamScoresFor(history);
  const results: BestBetRecommendation[] = [];

  for (const [selId, sel] of sels) {
    const fair = fairUsed.get(selId);
    if (!fair || fair <= 0 || fair >= 1) continue;
    const fairOdd = 1 / fair;

    const bookOdds = [...sel.byBook.values()];
    const marketMedian = median(bookOdds.map((o) => o.odd));
    const marketImplied = 1 / marketMedian;

    // Sanity cross-validation: fair deve essere "vicino" alla probabilità di mercato.
    if (Math.abs(fair - marketImplied) > sanityMaxDelta) continue;

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
    // Cap edge a 10% per O/U, 8% per mercati con 3 selezioni (1X2) — più stringente.
    let sharpEdgeVsSoft = 0;
    const edgeCap = expectedSelections === 2 ? 0.1 : 0.08;
    if (softOdds.length >= 2 && softMean > 0) {
      const raw = softMean * fair - 1;
      sharpEdgeVsSoft = Math.max(-edgeCap, Math.min(edgeCap, raw));
    }

    // Minors edge vs sharp: minori pagano molto di più dello sharp → anomalia sospetta
    const sharpOnSel = sharpOdds.filter((o) => o.selectionId === selId);
    const sharpMeanSel = sharpOnSel.length > 0
      ? sharpOnSel.reduce((a, b) => a + b.odd, 0) / sharpOnSel.length
      : 0;
    let minorsEdgeVsSharp = 0;
    if (minorOdds.length >= 3 && sharpMeanSel > 0 && minorMean > 0) {
      const raw = (minorMean - sharpMeanSel) / sharpMeanSel;
      minorsEdgeVsSharp = Math.max(-edgeCap, Math.min(edgeCap, raw));
    }

    const steamScore = steam.get(selId) ?? 0;

    // Confidence 0-100 — ricalibrato per funzionare sia su 1X2 (fair < 50%)
    // sia su OU (fair tipicamente 50-60%).
    let confidence = 25; // base: copertura sufficiente (già verificata)
    const reasoning: string[] = [];

    reasoning.push(
      `Probabilità reale stimata: <b>${(fair * 100).toFixed(1)}%</b> · quota giusta <b>${fairOdd.toFixed(2)}</b>.`,
    );

    // 1) Edge sharp vs soft (peso principale)
    if (sharpEdgeVsSoft > 0.015 && softOdds.length >= 2) {
      const bonus = Math.min(35, sharpEdgeVsSoft * 450); // edge 8% → 35pts
      confidence += bonus;
      reasoning.push(
        `Soft book (${softOdds.length}) pagano in media <b>${softMean.toFixed(2)}</b>: +${(sharpEdgeVsSoft * 100).toFixed(1)}% sopra il fair.`,
      );
    }

    // 2) Steam
    if (steamScore > 0.25) {
      confidence += Math.min(20, steamScore * 25);
      reasoning.push(
        `Steam: ${Math.round(steamScore * 100)}% dei book hanno abbassato la quota negli ultimi 10 min.`,
      );
    }

    // 3) Minori convergenti su quota alta
    if (minorsEdgeVsSharp > 0.03 && minorOdds.length >= 3) {
      confidence += Math.min(15, minorsEdgeVsSharp * 250);
      reasoning.push(
        `${minorOdds.length} book minori convergono su quota <b>${minorMean.toFixed(2)}</b> (+${(minorsEdgeVsSharp * 100).toFixed(1)}% sopra sharp).`,
      );
    }

    // 4) Consensus pick: fair molto alta anche senza edge specifico
    if (fair >= 0.55) {
      const bonus = Math.min(15, (fair - 0.5) * 75);
      confidence += bonus;
      if (sharpEdgeVsSoft <= 0.015) {
        reasoning.push(
          `Esito molto probabile secondo il consenso dei book (${sharpBookCount} sharp).`,
        );
      }
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
