import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect('/signals');

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-400 to-teal-600" />
        <h1 className="text-3xl font-bold tracking-tight">OddsRadar</h1>
      </div>
      <p className="text-center text-zinc-400">
        Anomaly scanner per bookmaker internazionali. Rileva arbitraggi, value bet
        e steam moves in tempo reale.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-cyan-500 px-6 py-3 font-medium text-zinc-950 hover:bg-cyan-400"
      >
        Accedi
      </Link>
    </main>
  );
}
