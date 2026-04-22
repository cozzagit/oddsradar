const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export function telegramEnabled(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

export async function sendTelegram(text: string, options: { silent?: boolean } = {}): Promise<boolean> {
  if (!telegramEnabled()) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: Boolean(options.silent),
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.warn('[telegram] HTTP', r.status, body.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[telegram] error:', err);
    return false;
  }
}

function esc(s: string | number | undefined | null): string {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

export interface BestBetMessageInput {
  home: string;
  away: string;
  competition: string;
  marketName: string;
  kickoffLocal: string;
  selectionLabel: string;
  fairOdd: number;
  marketMedianOdd: number;
  bestBookName: string;
  bestBookOdd: number;
  confidence: number;
  stakeEur: number;
  bankrollEur: number;
  reasoning: string[];
  url: string;
}

export function formatBestBetMessage(b: BestBetMessageInput): string {
  const stakePct = ((b.stakeEur / b.bankrollEur) * 100).toFixed(1);
  const bullets = b.reasoning.map((r) => `• ${r}`).join('\n');
  return (
    `🎯 <b>SCOMMESSA CONSIGLIATA</b> · Confidence <b>${Math.round(b.confidence)}/100</b>\n` +
    `${esc(b.home)} vs ${esc(b.away)}\n` +
    `<i>${esc(b.competition)} · ${esc(b.marketName)} · ${esc(b.kickoffLocal)}</i>\n\n` +
    `👉 Gioca: <b>${esc(b.selectionLabel)}</b>\n` +
    `💶 Stake: <b>€${b.stakeEur.toFixed(2)}</b> (${stakePct}% del bankroll €${b.bankrollEur})\n\n` +
    `Quota mediana di mercato: ${b.marketMedianOdd.toFixed(2)}\n` +
    `Quota "giusta" (fair): ${b.fairOdd.toFixed(2)}\n` +
    `Miglior quota disponibile: ${b.bestBookOdd.toFixed(2)} su ${esc(b.bestBookName)}\n\n` +
    `<b>Perché:</b>\n${bullets}\n\n` +
    `<a href="${b.url}">Apri OddsRadar</a>`
  );
}
