import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { aliasedTable } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

function fmtKickoff(d: Date) {
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      status: schema.signals.status,
      expiresAt: schema.signals.expiresAt,
      competition: schema.competitions.name,
      kickoff: schema.events.kickoffUtc,
      home: homeTeams.nameCanonical,
      away: awayTeams.nameCanonical,
      marketSlug: schema.markets.slug,
      marketName: schema.markets.name,
    })
    .from(schema.signals)
    .innerJoin(schema.events, eq(schema.events.id, schema.signals.eventId))
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .innerJoin(homeTeams, eq(homeTeams.id, schema.events.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, schema.events.awayTeamId))
    .leftJoin(schema.markets, eq(schema.markets.id, schema.signals.marketId))
    .where(eq(schema.signals.status, 'active'))
    .orderBy(desc(schema.signals.edge), desc(schema.signals.createdAt))
    .limit(100);

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Segnali live</h1>
        <span className="text-xs text-zinc-500">{rows.length} attivi</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-400">
          Nessun segnale attivo. Esegui <code className="rounded bg-zinc-800 px-1">npm run ingest:now</code> per
          popolare.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const payload = r.payload as Record<string, unknown>;
            return (
              <li
                key={r.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition hover:border-zinc-700"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          r.type === 'arb'
                            ? 'rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-semibold text-cyan-300'
                            : r.type === 'value'
                            ? 'rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300'
                            : 'rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300'
                        }
                      >
                        {r.type.toUpperCase()}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {r.competition} · {fmtKickoff(r.kickoff)}
                      </span>
                      {r.marketName && (
                        <span className="text-xs text-zinc-500">· {r.marketName}</span>
                      )}
                    </div>
                    <div className="mt-1 font-medium">
                      {r.home} <span className="text-zinc-500">vs</span> {r.away}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-cyan-400">+{fmtPct(r.edge)}</div>
                    <div className="text-xs text-zinc-500">edge</div>
                  </div>
                </div>

                {r.type === 'arb' && Array.isArray(payload.legs) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(payload.legs as Array<Record<string, unknown>>).map((leg, i) => (
                      <div
                        key={i}
                        className="rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm"
                      >
                        <div className="flex justify-between">
                          <span className="font-medium uppercase text-zinc-300">
                            {String(leg.selectionSlug)}
                          </span>
                          <span className="font-mono text-cyan-400">
                            @ {Number(leg.odd).toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex justify-between text-xs text-zinc-500">
                          <span>{String(leg.bookSlug)}</span>
                          <span>stake {(Number(leg.stakeShare) * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {r.type === 'value' && (
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <span className="text-zinc-400">
                      <span className="uppercase text-zinc-500">{String(payload.selectionSlug)}</span>{' '}
                      @ <span className="font-mono text-emerald-400">{Number(payload.offeredOdd).toFixed(2)}</span>
                      {' '}su <span className="text-zinc-300">{String(payload.bookSlug)}</span>
                    </span>
                    <span className="text-zinc-500">
                      fair {Number(payload.fairOdd).toFixed(2)} · prob {(Number(payload.fairProb) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}

                <div className="mt-2 text-xs text-zinc-600">
                  creato {r.createdAt.toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                  {r.expiresAt && ` · scade ${r.expiresAt.toLocaleString('it-IT', { hour: '2-digit', minute: '2-digit' })}`}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
