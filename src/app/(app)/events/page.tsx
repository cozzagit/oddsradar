import Link from 'next/link';
import { aliasedTable, eq, gte, asc, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const homeTeams = aliasedTable(schema.teams, 'home_teams');
  const awayTeams = aliasedTable(schema.teams, 'away_teams');

  const now = new Date();
  const rows = await db
    .select({
      id: schema.events.id,
      competition: schema.competitions.name,
      kickoff: schema.events.kickoffUtc,
      home: homeTeams.nameCanonical,
      away: awayTeams.nameCanonical,
      snapshotCount: sql<number>`coalesce((
        SELECT count(*) FROM odds_snapshots os WHERE os.event_id = ${schema.events.id}
      ), 0)::int`.as('snapshot_count'),
      bookCount: sql<number>`coalesce((
        SELECT count(DISTINCT os.book_id) FROM odds_snapshots os WHERE os.event_id = ${schema.events.id}
      ), 0)::int`.as('book_count'),
    })
    .from(schema.events)
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .innerJoin(homeTeams, eq(homeTeams.id, schema.events.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, schema.events.awayTeamId))
    .where(gte(schema.events.kickoffUtc, now))
    .orderBy(asc(schema.events.kickoffUtc))
    .limit(100);

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Eventi ({rows.length})</h1>
        <span className="text-xs text-zinc-500">prossimi 100</span>
      </div>
      <div className="space-y-1">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/events/${r.id}`}
            className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm hover:border-zinc-700"
          >
            <div>
              <div className="font-medium">
                {r.home} <span className="text-zinc-500">vs</span> {r.away}
              </div>
              <div className="text-xs text-zinc-500">
                {r.competition} ·{' '}
                {r.kickoff.toLocaleString('it-IT', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
            <div className="text-right text-xs text-zinc-500">
              <div>{r.snapshotCount} quote</div>
              <div>{r.bookCount} book</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
