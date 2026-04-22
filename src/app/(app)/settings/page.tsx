import { db, schema } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { telegramEnabled } from '@/lib/notify/telegram';
import { TelegramChatIdForm, TestTelegramButton } from './telegram-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [me] = await db
    .select()
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .limit(1);

  const tgConfigured = telegramEnabled();
  const edgeMin = Number(process.env.VALUE_EDGE_MIN ?? '0.03');
  const arbMin = Number(process.env.ARB_EDGE_MIN ?? '0.005');

  return (
    <section className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold">Impostazioni</h1>

      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Notifiche Telegram</h2>
        {tgConfigured ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">
              ✓ Bot configurato. Notifiche attive per ogni nuovo segnale rilevato.
            </p>
            <TestTelegramButton />
          </div>
        ) : (
          <div className="space-y-3 text-sm text-zinc-400">
            <p>Telegram non è ancora configurato sul server. Per attivarlo:</p>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>
                Apri Telegram, cerca <code className="rounded bg-zinc-800 px-1">@BotFather</code>, invia
                <code className="ml-1 rounded bg-zinc-800 px-1">/newbot</code>, scegli un nome (es.
                <em> OddsRadarLuca</em>) e un username (es. <em>oddsradar_luca_bot</em>).
              </li>
              <li>
                Copia il <strong>BOT_TOKEN</strong> che ti restituisce (formato{' '}
                <code>123456:ABC...</code>).
              </li>
              <li>
                Avvia una chat con il tuo bot (cerca lo username e premi Start), poi apri
                <a
                  href="https://api.telegram.org/bot<TOKEN>/getUpdates"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-cyan-400 underline"
                >
                  https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
                </a>{' '}
                sostituendo <code>&lt;TOKEN&gt;</code>: troverai il tuo <strong>chat.id</strong>.
              </li>
              <li>
                Sul VPS aggiungi <code>TELEGRAM_BOT_TOKEN</code> e <code>TELEGRAM_CHAT_ID</code> in
                <code> /var/www/oddsradar/.env</code>, poi riavvia i processi:
                <pre className="mt-1 overflow-x-auto rounded bg-zinc-950 p-2 text-xs">pm2 restart oddsradar-scheduler oddsradar-web</pre>
              </li>
            </ol>
            <TelegramChatIdForm />
          </div>
        )}
      </div>

      <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h2 className="mb-3 font-semibold">Soglie rilevamento (attuali)</h2>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded bg-zinc-950/50 p-3">
            <div className="text-xs text-zinc-500">Edge minimo ARBITRAGGIO</div>
            <div className="text-xl font-bold text-cyan-400">{(arbMin * 100).toFixed(2)}%</div>
          </div>
          <div className="rounded bg-zinc-950/50 p-3">
            <div className="text-xs text-zinc-500">Edge minimo VALUE BET</div>
            <div className="text-xl font-bold text-emerald-400">{(edgeMin * 100).toFixed(2)}%</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Per cambiare le soglie, modifica <code>ARB_EDGE_MIN</code> e <code>VALUE_EDGE_MIN</code> in
          <code> .env</code> sul VPS e riavvia <code>pm2 restart oddsradar-scheduler</code>.
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
