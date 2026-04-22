import { aliasedTable, and, eq, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const homeTeams = aliasedTable(schema.teams, 'home_teams');
  const awayTeams = aliasedTable(schema.teams, 'away_teams');

  const [event] = await db
    .select({
      id: schema.events.id,
      competition: schema.competitions.name,
      kickoff: schema.events.kickoffUtc,
      home: homeTeams.nameCanonical,
      away: awayTeams.nameCanonical,
    })
    .from(schema.events)
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .innerJoin(homeTeams, eq(homeTeams.id, schema.events.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, schema.events.awayTeamId))
    .where(eq(schema.events.id, id))
    .limit(1);

  if (!event) notFound();

  const latest = await db
    .select({
      marketName: schema.markets.name,
      marketSlug: schema.markets.slug,
      selectionName: schema.selections.name,
      selectionSlug: schema.selections.slug,
      bookName: schema.books.name,
      bookSlug: schema.books.slug,
      odd: schema.oddsSnapshots.odd,
      takenAt: schema.oddsSnapshots.takenAt,
    })
    .from(schema.oddsSnapshots)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.oddsSnapshots.marketId))
    .innerJoin(schema.selections, eq(schema.selections.id, schema.oddsSnapshots.selectionId))
    .innerJoin(schema.books, eq(schema.books.id, schema.oddsSnapshots.bookId))
    .where(eq(schema.oddsSnapshots.eventId, id))
    .orderBy(desc(schema.oddsSnapshots.takenAt));

  // group by market → selection → best per book (latest snapshot)
  type Row = (typeof latest)[number];
  const byMarket = new Map<string, { name: string; selections: Map<string, Row[]> }>();
  const seen = new Set<string>();
  for (const r of latest) {
    const key = `${r.marketSlug}:${r.selectionSlug}:${r.bookSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byMarket.has(r.marketSlug)) {
      byMarket.set(r.marketSlug, { name: r.marketName, selections: new Map() });
    }
    const m = byMarket.get(r.marketSlug)!;
    if (!m.selections.has(r.selectionSlug)) m.selections.set(r.selectionSlug, []);
    m.selections.get(r.selectionSlug)!.push(r);
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <div className="text-xs text-zinc-500">
          {event.competition} ·{' '}
          {event.kickoff.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
        <h1 className="text-2xl font-bold">
          {event.home} <span className="text-zinc-500">vs</span> {event.away}
        </h1>
      </div>

      {[...byMarket.entries()].map(([marketSlug, market]) => (
        <div key={marketSlug} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-400">{market.name}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[...market.selections.entries()].map(([selSlug, books]) => {
              const sorted = [...books].sort((a, b) => b.odd - a.odd);
              const best = sorted[0];
              return (
                <div
                  key={selSlug}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
                >
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm font-medium uppercase">{best.selectionName}</span>
                    <span className="font-mono text-lg text-cyan-400">{best.odd.toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-zinc-500">best: {best.bookName}</div>
                  <div className="mt-2 space-y-0.5 text-xs text-zinc-400">
                    {sorted.slice(1, 6).map((b, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{b.bookName}</span>
                        <span className="font-mono">{b.odd.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
