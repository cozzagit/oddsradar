import { and, desc, gte, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

export interface TypeStats {
  type: string;
  kind: string | null;
  total: number;
  won: number;
  lost: number;
  winRate: number;
  profit: number;
  roi: number;
}

export interface ConfidenceBucketStats {
  bucket: string;
  total: number;
  won: number;
  winRate: number;
  profit: number;
  roi: number;
}

export interface SignalStats {
  total: number;
  won: number;
  lost: number;
  void: number;
  unknown: number;
  pending: number;
  winRate: number;
  totalStake: number;
  totalProfit: number;
  roi: number;
  currentBankroll: number; // 1000 + profit
  byType: TypeStats[];
  byConfidence: ConfidenceBucketStats[];
}

const START_BANKROLL = 1000;

export async function computeSignalStats(daysBack = 30): Promise<SignalStats> {
  const since = new Date(Date.now() - daysBack * 24 * 3600 * 1000);

  const rows = await db
    .select({
      id: schema.signals.id,
      type: schema.signals.type,
      payload: schema.signals.payload,
      outcome: schema.signals.outcome,
      stake: schema.signals.simulatedStake,
      profit: schema.signals.simulatedProfit,
    })
    .from(schema.signals)
    .where(gte(schema.signals.createdAt, since));

  let won = 0, lost = 0, v = 0, unknown = 0, pending = 0;
  let totalStake = 0, totalProfit = 0;

  const typeMap = new Map<string, { won: number; lost: number; profit: number; stake: number; total: number }>();
  const confBuckets: Array<{ bucket: string; min: number; max: number; won: number; lost: number; profit: number; stake: number; total: number }> = [
    { bucket: '55-65', min: 55, max: 65, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
    { bucket: '65-75', min: 65, max: 75, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
    { bucket: '75-85', min: 75, max: 85, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
    { bucket: '85+', min: 85, max: 1000, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
  ];

  for (const r of rows) {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const kind = (payload.kind as string) ?? null;
    const typeKey = `${r.type}${kind ? ':' + kind : ''}`;
    const stake = Number(r.stake ?? 0);
    const profit = Number(r.profit ?? 0);
    const conf = Number(payload.confidence ?? 0);

    if (!typeMap.has(typeKey)) typeMap.set(typeKey, { won: 0, lost: 0, profit: 0, stake: 0, total: 0 });
    const ts = typeMap.get(typeKey)!;
    ts.total++;

    if (r.outcome === 'won') { won++; ts.won++; }
    else if (r.outcome === 'lost') { lost++; ts.lost++; }
    else if (r.outcome === 'void') v++;
    else if (r.outcome === 'unknown') unknown++;
    else pending++;

    if (r.outcome === 'won' || r.outcome === 'lost') {
      totalStake += stake;
      totalProfit += profit;
      ts.stake += stake;
      ts.profit += profit;

      const bucket = confBuckets.find((b) => conf >= b.min && conf < b.max);
      if (bucket) {
        bucket.total++;
        if (r.outcome === 'won') bucket.won++;
        else bucket.lost++;
        bucket.stake += stake;
        bucket.profit += profit;
      }
    }
  }

  const resolved = won + lost;
  const winRate = resolved > 0 ? won / resolved : 0;
  const roi = totalStake > 0 ? totalProfit / totalStake : 0;

  const byType: TypeStats[] = Array.from(typeMap.entries())
    .map(([key, data]) => {
      const [type, ...rest] = key.split(':');
      const kind = rest.length ? rest.join(':') : null;
      const resolvedT = data.won + data.lost;
      return {
        type,
        kind,
        total: data.total,
        won: data.won,
        lost: data.lost,
        winRate: resolvedT > 0 ? data.won / resolvedT : 0,
        profit: data.profit,
        roi: data.stake > 0 ? data.profit / data.stake : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const byConfidence: ConfidenceBucketStats[] = confBuckets.map((b) => ({
    bucket: b.bucket,
    total: b.total,
    won: b.won,
    winRate: b.total > 0 ? b.won / b.total : 0,
    profit: b.profit,
    roi: b.stake > 0 ? b.profit / b.stake : 0,
  }));

  return {
    total: rows.length,
    won,
    lost,
    void: v,
    unknown,
    pending,
    winRate,
    totalStake,
    totalProfit,
    roi,
    currentBankroll: START_BANKROLL + totalProfit,
    byType,
    byConfidence,
  };
}
