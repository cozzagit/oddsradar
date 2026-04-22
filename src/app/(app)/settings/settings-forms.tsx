'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function NotificationsToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    const r = await fetch('/api/settings/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (!r.ok) {
      setEnabled(!next);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={toggle}
        disabled={pending}
        className={
          'relative h-8 w-16 rounded-full transition ' +
          (enabled ? 'bg-emerald-500' : 'bg-zinc-700') +
          (pending ? ' opacity-50' : '')
        }
      >
        <span
          className={
            'absolute top-1 h-6 w-6 rounded-full bg-white transition-all ' +
            (enabled ? 'left-9' : 'left-1')
          }
        />
      </button>
      <span className={'font-bold ' + (enabled ? 'text-emerald-400' : 'text-red-400')}>
        {enabled ? 'ATTIVE' : 'IN PAUSA'}
      </span>
    </div>
  );
}

export function TestTelegramButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  async function send() {
    setStatus('loading');
    try {
      const r = await fetch('/api/settings/test-telegram', { method: 'POST' });
      setStatus(r.ok ? 'ok' : 'error');
    } catch {
      setStatus('error');
    }
  }
  return (
    <div>
      <button
        onClick={send}
        disabled={status === 'loading'}
        className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
      >
        {status === 'loading' ? 'Invio…' : 'Invia messaggio di test'}
      </button>
      {status === 'ok' && <span className="ml-3 text-sm text-emerald-400">inviato</span>}
      {status === 'error' && <span className="ml-3 text-sm text-red-400">errore</span>}
    </div>
  );
}

export function BankrollForm({ current }: { current: number }) {
  const [val, setVal] = useState(String(current));
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    const num = Number(val);
    if (!Number.isFinite(num) || num < 1) {
      setStatus('error');
      return;
    }
    const r = await fetch('/api/settings/bankroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bankrollEur: num }),
    });
    setStatus(r.ok ? 'ok' : 'error');
  }

  return (
    <form onSubmit={save} className="flex items-center gap-3">
      <span className="text-lg">€</span>
      <input
        type="number"
        min="1"
        step="10"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-32 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono outline-none focus:border-cyan-500"
      />
      <button
        type="submit"
        disabled={status === 'saving'}
        className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50"
      >
        Salva
      </button>
      {status === 'ok' && <span className="text-sm text-emerald-400">salvato</span>}
      {status === 'error' && <span className="text-sm text-red-400">errore</span>}
    </form>
  );
}
