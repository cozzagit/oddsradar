import { db, schema } from '@/lib/db';
import { desc } from 'drizzle-orm';
import { telegramEnabled } from '@/lib/notify/telegram';
import { isNotificationsEnabled } from '@/lib/settings';
import { TestTelegramButton, BankrollForm, NotificationsToggle } from './settings-forms';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [me] = await db
    .select()
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .limit(1);

  const tgConfigured = telegramEnabled();
  const notificationsOn = await isNotificationsEnabled();
  const minConfidence = Number(process.env.BET_MIN_CONFIDENCE ?? '60');
  const minEdge = Number(process.env.BET_MIN_EDGE ?? '0.02');

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Impostazioni</h1>

      <div
        className={
          'mb-6 rounded-lg border-2 p-4 ' +
          (notificationsOn
            ? 'border-emerald-700/60 bg-emerald-950/30'
            : 'border-red-700/60 bg-red-950/30')
        }
      >
        <h2 className="mb-3 font-semibold">
          Flusso segnali Telegram
        </h2>
        <p className="mb-3 text-sm text-zinc-300">
          {notificationsOn
            ? 'Il canale sta ricevendo segnali in tempo reale. Metti in pausa per fermarli.'
            : 'Notifiche IN PAUSA. Nessun messaggio verrà inviato al canale finché non riattivi.'}
        </p>
        <NotificationsToggle initial={notificationsOn} />
      </div>

      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Bankroll</h2>
        <p className="mb-3 text-sm text-zinc-400">
          Capitale di riferimento usato per calcolare gli stake suggeriti (Kelly frazionato 1/4, massimo 5% per
          giocata).
        </p>
        <BankrollForm current={Number(me?.bankrollEur ?? 500)} />
      </div>

      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Notifiche Telegram</h2>
        {tgConfigured ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">✓ Bot configurato. Notifiche attive.</p>
            <TestTelegramButton />
          </div>
        ) : (
          <p className="text-sm text-zinc-400">
            Non configurato. Aggiungi TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID in <code>.env</code> e riavvia.
          </p>
        )}
      </div>

      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Soglie segnali</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded bg-zinc-950/50 p-3">
            <div className="text-xs text-zinc-500">Confidence minima</div>
            <div className="text-xl font-bold text-cyan-400">{minConfidence}</div>
          </div>
          <div className="rounded bg-zinc-950/50 p-3">
            <div className="text-xs text-zinc-500">Edge minimo</div>
            <div className="text-xl font-bold text-emerald-400">{(minEdge * 100).toFixed(1)}%</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Modifica <code>BET_MIN_CONFIDENCE</code> e <code>BET_MIN_EDGE</code> in <code>.env</code>.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Account</h2>
        <p className="text-sm text-zinc-400">
          Email: <span className="text-zinc-200">{me?.email ?? '—'}</span>
        </p>
      </div>
    </section>
  );
}
