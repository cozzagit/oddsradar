'use client';

import { useState } from 'react';

export function TelegramChatIdForm() {
  return (
    <p className="mt-3 text-xs italic text-zinc-500">
      (UI in-app per salvare il token in arrivo in una versione successiva: ora configurazione via
      <code className="mx-1 rounded bg-zinc-800 px-1">.env</code>.)
    </p>
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
      {status === 'ok' && (
        <span className="ml-3 text-sm text-emerald-400">✓ inviato, controlla Telegram</span>
      )}
      {status === 'error' && (
        <span className="ml-3 text-sm text-red-400">errore — controlla i log server</span>
      )}
    </div>
  );
}
