import { isNotificationsEnabled } from '@/lib/settings';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export function telegramEnabled(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

export async function sendTelegram(text: string, options: { silent?: boolean; force?: boolean } = {}): Promise<boolean> {
  if (!telegramEnabled()) return false;
  if (!options.force) {
    const enabled = await isNotificationsEnabled();
    if (!enabled) return false;
  }
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

// ───────── Time framing ─────────
export type TimeFrame = 'live' | 'imminent' | 'today' | 'tomorrow' | 'this_week' | 'later';

export function classifyTime(kickoff: Date, liveElapsed?: number): {
  frame: TimeFrame;
  emoji: string;
  label: string;
} {
  if (liveElapsed != null && liveElapsed > 0) {
    return { frame: 'live', emoji: '🔴', label: `LIVE ${liveElapsed}'` };
  }
  const diffMin = (kickoff.getTime() - Date.now()) / 60_000;
  const fmtHour = kickoff.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  });

  if (diffMin < 0) return { frame: 'live', emoji: '🔴', label: 'IN CORSO' };
  if (diffMin < 60) return { frame: 'imminent', emoji: '🟠', label: `tra ${Math.round(diffMin)}min` };

  const now = new Date();
  const sameDay =
    kickoff.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) ===
    now.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    kickoff.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) ===
    tomorrow.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

  if (sameDay) return { frame: 'today', emoji: '🟢', label: `oggi ${fmtHour}` };
  if (isTomorrow) return { frame: 'tomorrow', emoji: '🟡', label: `domani ${fmtHour}` };
  if (diffMin < 60 * 24 * 7) {
    const wd = kickoff.toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'Europe/Rome' });
    return { frame: 'this_week', emoji: '🔵', label: `${wd} ${fmtHour}` };
  }
  const dmy = kickoff.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Europe/Rome',
  });
  return { frame: 'later', emoji: '⚪', label: `${dmy} ${fmtHour}` };
}

// ───────── Signal message ─────────
export interface BetMessageInput {
  home: string;
  away: string;
  competition: string;
  marketName: string;
  kickoff: Date;
  liveElapsed?: number;
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
  isLiveSteam?: boolean;
  oldOdd?: number; // per live steam
  newOdd?: number;
}

function confidenceBar(conf: number): string {
  const filled = Math.round((conf / 100) * 5);
  return '🔵'.repeat(filled) + '⚪'.repeat(Math.max(0, 5 - filled));
}

export function formatBetMessage(b: BetMessageInput): string {
  const t = classifyTime(b.kickoff, b.liveElapsed);
  const headline = `${t.emoji} <b>${t.label.toUpperCase()}</b> · ${esc(b.competition)}`;
  const matchLine = `<b>${esc(b.home)}</b> – <b>${esc(b.away)}</b>`;
  const pick = `👉 <b>${esc(b.selectionLabel)}</b> @ <code>${b.marketMedianOdd.toFixed(2)}</code>`;
  const stake = `💶 <b>€${b.stakeEur.toFixed(2)}</b> su bankroll €${b.bankrollEur.toFixed(0)}`;
  const confLine = `${confidenceBar(b.confidence)}  ${Math.round(b.confidence)}/100`;

  // Reasoning: prendi solo 1-2 ragioni più brevi, strip tag HTML tranne <b>
  const short = b.reasoning.slice(0, 2).map((r) => {
    const clean = r.replace(/<\/?b>/g, '').replace(/<[^>]+>/g, '');
    return `• ${clean.length > 110 ? clean.slice(0, 107) + '…' : clean}`;
  });

  // Compatto: se live steam, formato diverso
  if (b.isLiveSteam && b.oldOdd && b.newOdd) {
    return (
      `${headline}\n` +
      `${matchLine}\n` +
      `${esc(b.marketName)}\n\n` +
      `👉 <b>${esc(b.selectionLabel)}</b>  ${b.oldOdd.toFixed(2)} → <code>${b.newOdd.toFixed(2)}</code>\n` +
      `💶 <b>€${b.stakeEur.toFixed(2)}</b>\n\n` +
      `${short.join('\n')}\n\n` +
      `<a href="${b.url}">Apri</a>`
    );
  }

  return (
    `${headline}\n` +
    `${matchLine}\n` +
    `<i>${esc(b.marketName)}</i>\n\n` +
    `${pick}\n` +
    `${stake}\n` +
    `${confLine}\n\n` +
    `${short.join('\n')}\n\n` +
    `<a href="${b.url}">Apri</a>`
  );
}

// ── Backwards compat: vecchi handler ancora importati da ingest-now/ingest-live ──
export const formatBestBetMessage = (input: Omit<BetMessageInput, 'kickoff'> & { kickoffLocal?: string; kickoff?: Date }): string => {
  // Accetta sia vecchio shape (kickoffLocal string) sia nuovo (kickoff Date).
  let kickoff: Date;
  if (input.kickoff instanceof Date) kickoff = input.kickoff;
  else {
    const parsed = input.kickoffLocal ? Date.parse(input.kickoffLocal) : NaN;
    kickoff = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  }
  return formatBetMessage({ ...input, kickoff });
};
