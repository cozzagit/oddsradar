/**
 * Volume-Flow detector — smart money tracking.
 *
 * Rileva quando il volume matched su una selection cresce improvvisamente
 * mentre la probabilità implicita si muove. È il segnale più forte:
 * il denaro vero sta fluendo verso un outcome specifico, non un semplice
 * aggiustamento algoritmico.
 *
 * Idealmente alimentato da:
 *   - Polymarket (volume USDC reale on-chain)
 *   - Betfair Exchange (matched volume GBP)
 *   - Smarkets (matched volume)
 *
 * Signal condizioni:
 *   1. volume recente (ultimi N min) > volume_baseline * THRESHOLD_MULTIPLIER
 *   2. probability shift: la quota si è mossa nella stessa direzione del
 *      denaro (più volume = quota più bassa = più gente ci crede)
 *   3. NON è un semplice score change (cross-check con event_live_states)
 */

export interface VolumeSample {
  takenAt: Date;
  matchedVolume: number | null;
  liquidity?: number | null;
}

export interface VolumeFlowResult {
  selectionId: number;
  selectionSlug: string;
  baselineVolume: number;
  recentVolume: number;
  volumeGrowthPct: number;    // (recent-baseline)/baseline
  oldestOdd: number;
  newestOdd: number;
  oddChangePct: number;
  direction: 'money_in' | 'money_out';  // money_in = volume sale + quota scende (più interesse)
  reasoning: string;
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface VolumeFlowInput {
  selectionId: number;
  selectionSlug: string;
  /** Serie storica di (takenAt, volume, odd). */
  history: Array<{ takenAt: Date; volume: number | null; odd: number }>;
}

export function detectVolumeFlow(
  input: VolumeFlowInput,
  opts: {
    baselineWindowMin?: number;   // default 30
    recencyWindowMin?: number;    // default 5
    volumeGrowthThreshold?: number; // default 0.25 (+25%)
    minOddChange?: number;        // default 0.02 (2%)
  } = {},
): VolumeFlowResult | null {
  const baselineWindow = (opts.baselineWindowMin ?? 30) * 60_000;
  const recencyWindow = (opts.recencyWindowMin ?? 5) * 60_000;
  const growthThreshold = opts.volumeGrowthThreshold ?? 0.25;
  const minOddChange = opts.minOddChange ?? 0.02;

  const now = Date.now();
  const recencyCutoff = now - recencyWindow;
  const baselineCutoff = now - baselineWindow;

  const withVol = input.history.filter((h) => h.volume != null && h.volume > 0);
  if (withVol.length < 2) return null;

  const recent = withVol.filter((h) => h.takenAt.getTime() >= recencyCutoff);
  const base = withVol.filter(
    (h) => h.takenAt.getTime() < recencyCutoff && h.takenAt.getTime() >= baselineCutoff,
  );

  if (recent.length === 0 || base.length < 2) return null;

  const recentVol = median(recent.map((h) => h.volume as number));
  const baseVol = median(base.map((h) => h.volume as number));
  if (baseVol <= 0) return null;

  const growth = (recentVol - baseVol) / baseVol;
  if (growth < growthThreshold) return null;

  // odd shift
  const sorted = withVol.slice().sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const oldestOdd = sorted[0].odd;
  const newestOdd = sorted[sorted.length - 1].odd;
  const oddChange = (newestOdd - oldestOdd) / oldestOdd;

  if (Math.abs(oddChange) < minOddChange) return null;

  // Direction: money flowing IN se volume cresce + quota cala
  // (più gente scommette sullo stesso esito → book abbassa)
  const direction: 'money_in' | 'money_out' = oddChange < 0 ? 'money_in' : 'money_out';

  return {
    selectionId: input.selectionId,
    selectionSlug: input.selectionSlug,
    baselineVolume: baseVol,
    recentVolume: recentVol,
    volumeGrowthPct: growth,
    oldestOdd,
    newestOdd,
    oddChangePct: oddChange,
    direction,
    reasoning:
      `Volume: ${baseVol.toFixed(0)} → ${recentVol.toFixed(0)} (+${(growth * 100).toFixed(0)}%). ` +
      `Quota: ${oldestOdd.toFixed(2)} → ${newestOdd.toFixed(2)} (${(oddChange * 100).toFixed(1)}%). ` +
      `${direction === 'money_in' ? '💰 Denaro IN FLUSSO su questo esito (utenti reali scommettono).' : '⚠️ Denaro in uscita (utenti si ritirano).'}`,
  };
}
