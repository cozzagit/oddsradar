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
      headers: { 'Content-Type': 'application/json' },
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
      console.warn('[telegram] HTTP', r.status, body.slice(0, 200));
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

export interface ArbMessageInput {
  home: string;
  away: string;
  competition: string;
  kickoffLocal: string;
  edgePct: number;
  guaranteedProfit: number;
  totalStake: number;
  legs: Array<{ label: string; bookName: string; odd: number; stake: number }>;
  feasibility: 'easy' | 'medium' | 'hard';
  url: string;
}

export function formatArbMessage(a: ArbMessageInput): string {
  const feasEmoji = a.feasibility === 'easy' ? '✅' : a.feasibility === 'medium' ? '⚠️' : '🔴';
  const legsText = a.legs
    .map((l) => `  • <b>${esc(l.label)}</b> — €${l.stake.toFixed(2)} su ${esc(l.bookName)} @ ${l.odd.toFixed(2)}`)
    .join('\n');
  return (
    `🎯 <b>ARBITRAGGIO +${a.edgePct}%</b> ${feasEmoji}\n` +
    `${esc(a.home)} vs ${esc(a.away)}\n` +
    `<i>${esc(a.competition)} · ${esc(a.kickoffLocal)}</i>\n\n` +
    `<b>Profitto garantito: €${a.guaranteedProfit.toFixed(2)}</b> su €${a.totalStake}\n\n` +
    `${legsText}\n\n` +
    `<a href="${a.url}">Apri su OddsRadar</a>`
  );
}

export interface ValueMessageInput {
  home: string;
  away: string;
  competition: string;
  kickoffLocal: string;
  label: string;
  bookName: string;
  offeredOdd: number;
  fairOdd: number;
  edgePct: number;
  fairProbPct: number;
  suggestedStakePctBankroll: number;
  url: string;
}

export function formatValueMessage(v: ValueMessageInput): string {
  return (
    `💎 <b>VALUE BET +${v.edgePct}%</b>\n` +
    `${esc(v.home)} vs ${esc(v.away)}\n` +
    `<i>${esc(v.competition)} · ${esc(v.kickoffLocal)}</i>\n\n` +
    `Punta su <b>${esc(v.label)} @ ${v.offeredOdd.toFixed(2)}</b>\n` +
    `su ${esc(v.bookName)}\n\n` +
    `Quota giusta: ${v.fairOdd.toFixed(2)} (prob. reale ${v.fairProbPct.toFixed(1)}%)\n` +
    `Stake suggerito: ${v.suggestedStakePctBankroll.toFixed(2)}% del bankroll\n\n` +
    `<a href="${v.url}">Apri su OddsRadar</a>`
  );
}
