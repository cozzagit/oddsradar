import { and, gte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';

export interface TypeStats {
  type: string;
  kind: string | null;
  total: number;
  resolved: number;
  won: number;
  lost: number;
  winRate: number;
  profit: number;
  roi: number;
  avgOdd: number;
  suggestedStakeEur: number;
  autoDisabled: boolean;
  autoDisabledReason?: string;
}

export interface ConfidenceBucketStats {
  bucket: string;
  total: number;
  won: number;
  winRate: number;
  profit: number;
  roi: number;
}

export interface LeagueStats {
  competition: string;
  total: number;
  won: number;
  lost: number;
  winRate: number;
  profit: number;
  roi: number;
}

export interface SourceStats {
  bookSlug: string;
  total: number;
  won: number;
  winRate: number;
  profit: number;
  roi: number;
}

export interface DayStats {
  day: string; // YYYY-MM-DD
  resolved: number;
  profit: number;
  cumulativeBankroll: number;
}

export interface SignalStats {
  period: { from: Date; to: Date; days: number };
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
  currentBankroll: number;
  byType: TypeStats[];
  byConfidence: ConfidenceBucketStats[];
  byLeague: LeagueStats[];
  bySource: SourceStats[];
  byDay: DayStats[];
}

const START_BANKROLL = 1000;
const FIXED_STAKE = 10;

// Kill-switch threshold: se un kind ha >= N risolti con WR < MIN_WR, auto-disabled
const AUTO_DISABLE_MIN_RESOLVED = 20;
const AUTO_DISABLE_MAX_WR = 0.38;

/** Kelly frazionato (1/4) per suggerire stake dinamico dato WR e avgOdd storici. */
function suggestStake(wr: number, avgOdd: number, base: number = FIXED_STAKE): number {
  if (avgOdd <= 1.01 || wr <= 0 || wr >= 1) return base;
  const edge = avgOdd * wr - 1;
  if (edge <= 0) return base * 0.3; // kind in perdita: stake ridotto
  const kelly = edge / (avgOdd - 1);
  const fractional = Math.max(0.3, Math.min(2.5, kelly / 4 * 10)); // scalato su base €10
  return Number((base * fractional).toFixed(2));
}

export async function computeSignalStats(daysBack = 30): Promise<SignalStats> {
  const from = new Date(Date.now() - daysBack * 24 * 3600 * 1000);
  const to = new Date();

  const rows = await db
    .select({
      id: schema.signals.id,
      type: schema.signals.type,
      payload: schema.signals.payload,
      outcome: schema.signals.outcome,
      createdAt: schema.signals.createdAt,
      resolvedAt: schema.signals.resolvedAt,
      stake: schema.signals.simulatedStake,
      profit: schema.signals.simulatedProfit,
      eventId: schema.signals.eventId,
      competitionId: schema.events.competitionId,
    })
    .from(schema.signals)
    .innerJoin(schema.events, eq(schema.events.id, schema.signals.eventId))
    .where(gte(schema.signals.createdAt, from));

  const comps = await db.select().from(schema.competitions);
  const compName = new Map(comps.map((c) => [c.id, c.name]));

  let won = 0, lost = 0, v = 0, unknown = 0, pending = 0;
  let totalStake = 0, totalProfit = 0;

  const typeMap = new Map<string, { won: number; lost: number; profit: number; stake: number; total: number; oddSum: number; oddCount: number }>();
  const confBuckets = [
    { bucket: '55-65', min: 55, max: 65, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
    { bucket: '65-75', min: 65, max: 75, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
    { bucket: '75-85', min: 75, max: 85, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
    { bucket: '85+', min: 85, max: 1000, won: 0, lost: 0, profit: 0, stake: 0, total: 0 },
  ];
  const leagueMap = new Map<string, { won: number; lost: number; profit: number; stake: number; total: number }>();
  const sourceMap = new Map<string, { won: number; lost: number; profit: number; stake: number; total: number }>();

  // byDay cumulative bankroll
  const dailyProfits = new Map<string, number>();
  const dailyResolved = new Map<string, number>();

  for (const r of rows) {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const kind = (payload.kind as string) ?? null;
    const typeKey = `${r.type}${kind ? ':' + kind : ''}`;
    const stake = Number(r.stake ?? 0);
    const profit = Number(r.profit ?? 0);
    const conf = Number(payload.confidence ?? 0);
    const odd = Number(payload.marketMedianOdd ?? payload.bestBookOdd ?? payload.fairOdd ?? 0);
    const bookSlug = String(payload.bestBookSlug ?? payload.bookSlug ?? 'unknown');
    const competition = compName.get(r.competitionId) ?? 'Unknown';

    if (!typeMap.has(typeKey)) typeMap.set(typeKey, { won: 0, lost: 0, profit: 0, stake: 0, total: 0, oddSum: 0, oddCount: 0 });
    const ts = typeMap.get(typeKey)!;
    ts.total++;
    if (odd > 1) { ts.oddSum += odd; ts.oddCount++; }

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

      // By confidence
      const bucket = confBuckets.find((b) => conf >= b.min && conf < b.max);
      if (bucket) {
        bucket.total++;
        if (r.outcome === 'won') bucket.won++;
        else bucket.lost++;
        bucket.stake += stake;
        bucket.profit += profit;
      }

      // By league
      if (!leagueMap.has(competition)) leagueMap.set(competition, { won: 0, lost: 0, profit: 0, stake: 0, total: 0 });
      const lm = leagueMap.get(competition)!;
      lm.total++;
      lm.stake += stake;
      lm.profit += profit;
      if (r.outcome === 'won') lm.won++;
      else lm.lost++;

      // By source
      if (!sourceMap.has(bookSlug)) sourceMap.set(bookSlug, { won: 0, lost: 0, profit: 0, stake: 0, total: 0 });
      const sm = sourceMap.get(bookSlug)!;
      sm.total++;
      sm.stake += stake;
      sm.profit += profit;
      if (r.outcome === 'won') sm.won++;
      else sm.lost++;

      // By day
      if (r.resolvedAt) {
        const day = r.resolvedAt.toISOString().slice(0, 10);
        dailyProfits.set(day, (dailyProfits.get(day) ?? 0) + profit);
        dailyResolved.set(day, (dailyResolved.get(day) ?? 0) + 1);
      }
    }
  }

  const resolved = won + lost;
  const winRate = resolved > 0 ? won / resolved : 0;
  const roi = totalStake > 0 ? totalProfit / totalStake : 0;

  // byType with dynamic stake + auto-disable
  const byType: TypeStats[] = Array.from(typeMap.entries())
    .map(([key, d]) => {
      const [type, ...rest] = key.split(':');
      const kind = rest.length ? rest.join(':') : null;
      const resolvedT = d.won + d.lost;
      const wrT = resolvedT > 0 ? d.won / resolvedT : 0;
      const avgOddT = d.oddCount > 0 ? d.oddSum / d.oddCount : 0;
      const suggested = suggestStake(wrT, avgOddT);
      const shouldDisable = resolvedT >= AUTO_DISABLE_MIN_RESOLVED && wrT < AUTO_DISABLE_MAX_WR;
      const disableReason = shouldDisable
        ? `${resolvedT} risolti, WR ${(wrT * 100).toFixed(1)}% < 38%`
        : undefined;
      return {
        type,
        kind,
        total: d.total,
        resolved: resolvedT,
        won: d.won,
        lost: d.lost,
        winRate: wrT,
        profit: d.profit,
        roi: d.stake > 0 ? d.profit / d.stake : 0,
        avgOdd: avgOddT,
        suggestedStakeEur: suggested,
        autoDisabled: shouldDisable,
        autoDisabledReason: disableReason,
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

  const byLeague: LeagueStats[] = Array.from(leagueMap.entries())
    .map(([competition, d]) => ({
      competition,
      total: d.total,
      won: d.won,
      lost: d.lost,
      winRate: d.total > 0 ? d.won / d.total : 0,
      profit: d.profit,
      roi: d.stake > 0 ? d.profit / d.stake : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const bySource: SourceStats[] = Array.from(sourceMap.entries())
    .map(([bookSlug, d]) => ({
      bookSlug,
      total: d.total,
      won: d.won,
      winRate: d.total > 0 ? d.won / d.total : 0,
      profit: d.profit,
      roi: d.stake > 0 ? d.profit / d.stake : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // byDay: fill gaps con 0, cumulative bankroll starting from START_BANKROLL
  const byDay: DayStats[] = [];
  let cum = START_BANKROLL;
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const day = d.toISOString().slice(0, 10);
    const p = dailyProfits.get(day) ?? 0;
    cum += p;
    byDay.push({
      day,
      resolved: dailyResolved.get(day) ?? 0,
      profit: p,
      cumulativeBankroll: Number(cum.toFixed(2)),
    });
  }

  return {
    period: { from, to, days: daysBack },
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
    byLeague,
    bySource,
    byDay,
  };
}
