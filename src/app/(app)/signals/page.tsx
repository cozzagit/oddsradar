export const dynamic = 'force-dynamic';

export default function SignalsPage() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Segnali live</h1>
        <span className="text-xs text-zinc-500">placeholder MVP</span>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-400">
        Nessun segnale ancora. Avvia l&apos;ingestion per popolare il feed.
      </div>
    </section>
  );
}
