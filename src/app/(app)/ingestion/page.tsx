import { db, schema } from '@/lib/db';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function IngestionPage() {
  const books = await db.select().from(schema.books).orderBy(desc(schema.books.enabled));
  const recentRuns = await db
    .select()
    .from(schema.ingestionRuns)
    .orderBy(desc(schema.ingestionRuns.startedAt))
    .limit(20);

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Fonti & Ingestion</h1>

      <h2 className="mb-2 text-sm font-semibold text-zinc-400">Bookmaker configurati ({books.length})</h2>
      <div className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {books.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2"
          >
            <div>
              <div className="font-medium">{b.name}</div>
              <div className="text-xs text-zinc-500">
                {b.country ?? '—'} · tier {b.tier} {b.isSharp && '· sharp'}
              </div>
            </div>
            <span
              className={
                b.enabled
                  ? 'rounded-full bg-green-900/40 px-2 py-0.5 text-xs text-green-400'
                  : 'rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500'
              }
            >
              {b.enabled ? 'attivo' : 'off'}
            </span>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-zinc-400">Ultimi run ({recentRuns.length})</h2>
      {recentRuns.length === 0 ? (
        <p className="text-sm text-zinc-500">Nessun run ancora eseguito.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500">
            <tr>
              <th className="py-1">Book</th>
              <th>Start</th>
              <th>Items</th>
              <th>Errori</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800">
                <td className="py-1">{r.bookId}</td>
                <td>{r.startedAt.toISOString().replace('T', ' ').slice(0, 19)}</td>
                <td>{r.itemsInserted}/{r.itemsFetched}</td>
                <td>{r.errorsCount}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
