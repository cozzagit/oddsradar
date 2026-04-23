import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { computeSignalStats } from '@/lib/signals/stats';
import { db, schema } from '@/lib/db';
import { aliasedTable, desc } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtEur(n: number): string {
  const s = n >= 0 ? '+' : '';
  return `${s}€${n.toFixed(2)}`;
}

export default async function AdminSignalsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'admin') redirect('/signals');

  const stats = await computeSignalStats(30);
  const bankrollDelta = stats.currentBankroll - 1000;
  const bankrollDeltaPct = bankrollDelta / 10; // %1000

  // Tabella ultimi signal risolti
  const homeTeams = aliasedTable(schema.teams, 'home_teams');
  const awayTeams = aliasedTable(schema.teams, 'away_teams');
  const recent = await db
    .select({
      id: schema.signals.id,
      type: schema.signals.type,
      payload: schema.signals.payload,
      createdAt: schema.signals.createdAt,
      outcome: schema.signals.outcome,
      resolvedAt: schema.signals.resolvedAt,
      scoreH: schema.signals.actualScoreHome,
      scoreA: schema.signals.actualScoreAway,
      profit: schema.signals.simulatedProfit,
      stake: schema.signals.simulatedStake,
      home: homeTeams.nameCanonical,
      away: awayTeams.nameCanonical,
      competition: schema.competitions.name,
      marketName: schema.markets.name,
      selectionSlug: schema.selections.slug,
    })
    .from(schema.signals)
    .innerJoin(schema.events, eq(schema.events.id, schema.signals.eventId))
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .innerJoin(homeTeams, eq(homeTeams.id, schema.events.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, schema.events.awayTeamId))
    .leftJoin(schema.markets, eq(schema.markets.id, schema.signals.marketId))
    .leftJoin(schema.selections, eq(schema.selections.id, schema.signals.selectionId))
    .orderBy(desc(schema.signals.createdAt))
    .limit(80);

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">📊 Admin — Signal Performance</h1>

      {/* Bankroll virtuale */}
      <div className="mb-6 rounded-xl border-2 border-cyan-700/50 bg-zinc-900/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Bankroll virtuale</div>
            <div className="text-4xl font-bold">
              €{stats.currentBankroll.toFixed(2)}
              <span
                className={
                  'ml-3 text-lg ' + (bankrollDelta >= 0 ? 'text-emerald-400' : 'text-red-400')
                }
              >
                {fmtEur(bankrollDelta)} ({bankrollDeltaPct >= 0 ? '+' : ''}{bankrollDeltaPct.toFixed(2)}%)
              </span>
            </div>
            <div className="text-xs text-zinc-500">start €1000 · stake €10 per segnale risolto</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-zinc-500">Ultimi 30 giorni</div>
            <div className="text-2xl font-bold">{stats.total} <span className="text-sm text-zinc-400">segnali</span></div>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Win rate" value={pct(stats.winRate)} sub={`${stats.won}W / ${stats.lost}L`} />
        <Kpi label="ROI" value={pct(stats.roi)} sub={`su €${stats.totalStake.toFixed(0)} stake`} accent={stats.roi >= 0 ? 'emerald' : 'red'} />
        <Kpi label="Risolti" value={String(stats.won + stats.lost + stats.void)} sub={`${stats.pending} pending, ${stats.unknown} non trovati`} />
        <Kpi label="Profit totale" value={fmtEur(stats.totalProfit)} accent={stats.totalProfit >= 0 ? 'emerald' : 'red'} />
      </div>

      {/* Per tipo */}
      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Performance per tipo</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 text-left">Tipo</th>
                <th className="text-right">Totale</th>
                <th className="text-right">Win rate</th>
                <th className="text-right">Profit</th>
                <th className="text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {stats.byType.map((t, i) => (
                <tr key={i} className="border-t border-zinc-800">
                  <td className="py-1.5 font-mono">{t.type}{t.kind ? ` · ${t.kind}` : ''}</td>
                  <td className="text-right">{t.total}</td>
                  <td className="text-right">
                    <span className={t.winRate >= 0.5 ? 'text-emerald-400' : 'text-zinc-400'}>
                      {pct(t.winRate)} ({t.won}W/{t.lost}L)
                    </span>
                  </td>
                  <td className={'text-right ' + (t.profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {fmtEur(t.profit)}
                  </td>
                  <td className={'text-right ' + (t.roi >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {pct(t.roi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per confidence */}
      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Performance per confidence</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.byConfidence.map((b) => (
            <div key={b.bucket} className="rounded bg-zinc-950/50 p-3">
              <div className="text-xs text-zinc-500">{b.bucket}</div>
              <div className="text-lg font-bold">{b.total}</div>
              <div className="text-xs text-zinc-400">WR: {pct(b.winRate)}</div>
              <div className={'text-xs ' + (b.roi >= 0 ? 'text-emerald-400' : 'text-red-400')}>ROI: {pct(b.roi)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabella recenti */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Ultimi segnali ({recent.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left">Quando</th>
                <th className="text-left">Match</th>
                <th className="text-left">Pick</th>
                <th className="text-right">Odd</th>
                <th className="text-center">Outcome</th>
                <th className="text-right">Score</th>
                <th className="text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const p = (r.payload ?? {}) as Record<string, unknown>;
                const odd = Number(p.marketMedianOdd ?? p.bestBookOdd ?? 0);
                const outcomeColor =
                  r.outcome === 'won' ? 'bg-emerald-500/20 text-emerald-300'
                  : r.outcome === 'lost' ? 'bg-red-500/20 text-red-300'
                  : r.outcome === 'pending' ? 'bg-zinc-700 text-zinc-400'
                  : 'bg-amber-500/20 text-amber-300';
                return (
                  <tr key={r.id} className="border-t border-zinc-800">
                    <td className="py-1 text-zinc-500">
                      {r.createdAt.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-1">
                      <div>{r.home} – {r.away}</div>
                      <div className="text-zinc-600">{r.competition}</div>
                    </td>
                    <td className="py-1">
                      <div>{r.selectionSlug}</div>
                      <div className="text-zinc-600">{r.marketName}</div>
                    </td>
                    <td className="py-1 text-right font-mono">{odd ? odd.toFixed(2) : '—'}</td>
                    <td className="py-1 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${outcomeColor}`}>
                        {r.outcome}
                      </span>
                    </td>
                    <td className="py-1 text-right font-mono text-zinc-400">
                      {r.scoreH != null && r.scoreA != null ? `${r.scoreH}-${r.scoreA}` : '—'}
                    </td>
                    <td className={'py-1 text-right font-mono ' + (Number(r.profit ?? 0) > 0 ? 'text-emerald-400' : Number(r.profit ?? 0) < 0 ? 'text-red-400' : 'text-zinc-500')}>
                      {r.profit != null ? fmtEur(Number(r.profit)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'emerald' | 'red' }) {
  const color = accent === 'emerald' ? 'text-emerald-400' : accent === 'red' ? 'text-red-400' : 'text-zinc-100';
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
