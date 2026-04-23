import Link from 'next/link';
import { auth, signOut } from '@/lib/auth/auth';
import { redirect } from 'next/navigation';
import { isNotificationsEnabled } from '@/lib/settings';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const notifOn = await isNotificationsEnabled();

  return (
    <div className="flex min-h-screen flex-col">
      {!notifOn && (
        <Link
          href="/settings"
          className="sticky top-0 z-30 flex items-center justify-center gap-2 border-b border-red-800 bg-red-900/80 px-4 py-2 text-xs font-semibold text-red-100 backdrop-blur hover:bg-red-900"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-300" />
          NOTIFICHE IN PAUSA — clicca per gestire
        </Link>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur">
        <Link href="/signals" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-gradient-to-br from-cyan-400 to-teal-600" />
          <span className="font-bold">OddsRadar</span>
        </Link>
        <nav className="hidden gap-4 text-sm text-zinc-400 sm:flex">
          <Link href="/signals" className="hover:text-zinc-100">Segnali</Link>
          <Link href="/events" className="hover:text-zinc-100">Eventi</Link>
          <Link href="/ingestion" className="hover:text-zinc-100">Fonti</Link>
          {session.user.role === 'admin' && (
            <Link href="/admin/signals" className="text-amber-400 hover:text-amber-300">Admin</Link>
          )}
          <Link href="/settings" className="hover:text-zinc-100">Impostazioni</Link>
        </nav>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button className="text-xs text-zinc-400 hover:text-zinc-100">Esci</button>
        </form>
      </header>
      <main className="flex-1">{children}</main>
      <nav className="flex items-center justify-around border-t border-zinc-800 bg-zinc-950 py-2 sm:hidden">
        <Link href="/signals" className="px-3 py-2 text-xs">Segnali</Link>
        <Link href="/events" className="px-3 py-2 text-xs">Eventi</Link>
        <Link href="/ingestion" className="px-3 py-2 text-xs">Fonti</Link>
        <Link href="/settings" className="px-3 py-2 text-xs">Setup</Link>
      </nav>
    </div>
  );
}
