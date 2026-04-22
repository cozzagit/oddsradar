import Link from 'next/link';
import { aliasedTable, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { bookLabel, selectionLabel } from '@/lib/signals/actionable';

export const dynamic = 'force-dynamic';

function fmtKickoff(d: Date) {
  return d.toLocaleString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relKickoff(d: Date): string {
  const diff = d.getTime() - Date.now();
  if (diff < 0) return 'iniziato';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `tra ${Math.max(1, Math.floor(diff / 60_000))} min`;
  if (h < 24) return `tra ${h}h`;
  const d2 = Math.floor(h / 24);
  return `tra ${d2}g ${h % 24}h`;
}

export default async function SignalsPage() {
  const homeTeams = aliasedTable(schema.teams, 'home_teams');
  const awayTeams = aliasedTable(schema.teams, 'away_teams');

  const rows = await db
    .select({
      id: schema.signals.id,
      type: schema.signals.type,
      edge: schema.signals.edge,
      payload: schema.signals.payload,
      createdAt: schema.signals.createdAt,
      expiresAt: schema.signals.expiresAt,
      eventId: schema.events.id,
      competition: schema.competitions.name,
      kickoff: schema.events.kickoffUtc,
      home: homeTeams.nameCanonical,
      away: awayTeams.nameCanonical,
      marketName: schema.markets.name,
    })
    .from(schema.signals)
    .innerJoin(schema.events, eq(schema.events.id, schema.signals.eventId))
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .innerJoin(homeTeams, eq(homeTeams.id, schema.events.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, schema.events.awayTeamId))
    .leftJoin(schema.markets, eq(schema.markets.id, schema.signals.marketId))
    .where(eq(schema.signals.status, 'active'))
    .orderBy(desc(schema.signals.createdAt));

  const bets = rows.filter((r) => r.type === 'bet');

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Cosa giocare oggi</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Una raccomandazione per evento, ordinata per confidence. Gioca sul tuo book preferito.
        </p>
      </div>

      {bets.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-400">
          Nessun segnale con confidence sufficiente al momento.
          <div className="mt-2 text-xs text-zinc-500">
            Il sistema analizza ogni 5 min. Se tutto il mercato è allineato, non ci sono opportunità da giocare.
          </div>
        </div>
      ) : (
        <ul className="space-y-4">
          {bets.map((r) => {
            const p = r.payload as Record<string, unknown> & {
              selectionSlug: string;
              fairOdd: number;
              marketMedianOdd: number;
              bestBookSlug: string;
              bestBookOdd: number;
              confidence: number;
              stakeEur: number;
              bankrollEur: number;
              reasoning: string[];
              scores: { sharpEdgeVsSoft: number; steamScore: number; minorsEdgeVsSharp: number };
              soft: { bookCount: number; meanOdd: number };
              minors: { bookCount: number; meanOdd: number };
              fairProb: number;
            };
            const confidence = Math.round(Number(p.confidence ?? 0));
            const confColor =
              confidence >= 80 ? 'text-emerald-400' : confidence >= 65 ? 'text-cyan-400' : 'text-amber-400';
            const stakePct = p.bankrollEur ? (p.stakeEur / p.bankrollEur) * 100 : 0;

            return (
              <li
                key={r.id}
                className="overflow-hidden rounded-xl border-2 border-zinc-800 bg-zinc-900/60 transition hover:border-zinc-700"
              >
                <div className="border-b border-zinc-800 bg-zinc-950/60 px-4 py-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
                    <span>{r.competition} · {r.marketName}</span>
                    <span>{fmtKickoff(r.kickoff)} · {relKickoff(r.kickoff)}</span>
                  </div>
                  <Link href={`/events/${r.eventId}`} className="text-lg font-semibold hover:underline">
                    {r.home} <span className="text-zinc-500">vs</span> {r.away}
                  </Link>
                </div>

                <div className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-zinc-500">Gioca</div>
                      <div className="text-2xl font-bold">
                        {selectionLabel(p.selectionSlug, r.home, r.away)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wide text-zinc-500">Confidence</div>
                      <div className={`text-3xl font-bold ${confColor}`}>{confidence}<span className="text-base text-zinc-500">/100</span></div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <Kpi label="Stake suggerito" value={`€${Number(p.stakeEur).toFixed(2)}`} sub={`${stakePct.toFixed(1)}% di €${p.bankrollEur}`} accent />
                    <Kpi label="Quota 'giusta'" value={Number(p.fairOdd).toFixed(2)} sub={`prob ${(p.fairProb * 100).toFixed(1)}%`} />
                    <Kpi label="Miglior quota" value={Number(p.bestBookOdd).toFixed(2)} sub={bookLabel(p.bestBookSlug)} />
                  </div>

                  <div className="mt-4 rounded-md bg-zinc-950/50 p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">Perché</div>
                    <ul className="space-y-1 text-sm text-zinc-300">
                      {p.reasoning.map((r2, i) => (
                        <li key={i} dangerouslySetInnerHTML={{ __html: '• ' + r2 }} />
                      ))}
                    </ul>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                    <Badge label={`mediana ${Number(p.marketMedianOdd).toFixed(2)}`} />
                    {p.soft.bookCount > 0 && <Badge label={`${p.soft.bookCount} soft · media ${p.soft.meanOdd.toFixed(2)}`} />}
                    {p.minors.bookCount > 0 && <Badge label={`${p.minors.bookCount} minori · media ${p.minors.meanOdd.toFixed(2)}`} />}
                    {p.scores.steamScore > 0 && <Badge label={`steam ${Math.round(p.scores.steamScore * 100)}%`} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Come legge i segnali</summary>
        <div className="mt-3 space-y-2 text-zinc-400">
          <p>
            <strong className="text-zinc-200">Confidence</strong> è un punteggio 0-100 che combina probabilità reale,
            disaccordo tra sharp e soft, movimenti rapidi di quota (steam) e anomalie dei book minori.
          </p>
          <p>
            <strong className="text-zinc-200">Stake</strong> è calcolato col Kelly frazionato 1/4 sul tuo bankroll
            (€{' '}
            <code>impostato in Settings</code>). Massimo 5% per singola giocata.
          </p>
          <p>
            <strong className="text-zinc-200">Gioca dove vuoi</strong>. Noi ti diciamo <em>cosa</em>, tu scegli il
            book. La &quot;miglior quota&quot; è solo informativa per valutare se il tuo book è in linea.
          </p>
        </div>
      </details>
    </section>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-md bg-zinc-950/50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return <span className="rounded bg-zinc-800 px-1.5 py-0.5">{label}</span>;
}
