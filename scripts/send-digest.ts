/**
 * Digest ogni 30 min. Legge i segnali attivi/recenti della finestra
 * precedente e produce un promemoria stringato suddiviso per fascia
 * temporale (live / oggi / domani / futuro).
 */
import 'dotenv/config';
import { and, desc, gte, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import { selectionLabel } from '../src/lib/signals/actionable';
import { sendTelegram, telegramEnabled } from '../src/lib/notify/telegram';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3041';
const WINDOW_MIN = Number(process.env.DIGEST_WINDOW_MIN ?? '30');

type SignalRow = {
  id: number;
  eventId: number;
  marketId: number | null;
  selectionId: number | null;
  edge: number;
  payload: unknown;
  createdAt: Date;
  type: 'arb' | 'value' | 'steam' | 'bet';
};

function classifyTime(kickoff: Date): { group: 'live' | 'today' | 'tomorrow' | 'later'; label: string } {
  const now = new Date();
  const minutesTo = (kickoff.getTime() - now.getTime()) / 60_000;
  const fmt = (d: Date) =>
    d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });

  // Live: kickoff passato da 5-150 min
  if (minutesTo >= -150 && minutesTo <= -5) return { group: 'live', label: 'LIVE' };

  const dKick = kickoff.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
  const dNow = now.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dTom = tomorrow.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

  if (dKick === dNow) return { group: 'today', label: fmt(kickoff) };
  if (dKick === dTom) return { group: 'tomorrow', label: `dom ${fmt(kickoff)}` };
  const wd = kickoff.toLocaleDateString('it-IT', { weekday: 'short', timeZone: 'Europe/Rome' });
  return { group: 'later', label: `${wd} ${fmt(kickoff)}` };
}

const SEL_SHORT: Record<string, (h: string, a: string) => string> = {
  home: (h) => `1 ${h}`,
  draw: () => `X`,
  away: (_, a) => `2 ${a}`,
  over: () => `Over 2.5`,
  under: () => `Under 2.5`,
  yes: () => `Goal`,
  no: () => `No Goal`,
};

function shortSelection(selSlug: string, home: string, away: string): string {
  const fn = SEL_SHORT[selSlug];
  return fn ? fn(home, away) : selSlug;
}

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === DIGEST ${WINDOW_MIN}min ===`);
  if (!telegramEnabled()) {
    console.log('telegram not configured, skip');
    return;
  }

  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const sigs = (await db
    .select()
    .from(schema.signals)
    .where(
      and(
        gte(schema.signals.createdAt, since),
        eq(schema.signals.type, 'bet'),
      ),
    )
    .orderBy(desc(schema.signals.createdAt))) as SignalRow[];

  if (sigs.length === 0) {
    console.log('  no signals in window, skip digest');
    return;
  }

  // Dedup per (evento, selezione) — tengo solo il più recente/edge più alto
  const best = new Map<string, SignalRow>();
  for (const s of sigs) {
    const key = `${s.eventId}:${s.selectionId ?? 'x'}`;
    const existing = best.get(key);
    if (!existing || s.edge > existing.edge) best.set(key, s);
  }

  const eventIds = Array.from(new Set([...best.values()].map((s) => s.eventId)));
  if (eventIds.length === 0) return;

  const events = await db.select().from(schema.events).where(inArray(schema.events.id, eventIds));
  const teams = await db.select().from(schema.teams);
  const comps = await db.select().from(schema.competitions);
  const teamName = new Map(teams.map((t) => [t.id, t.nameCanonical]));
  const compName = new Map(comps.map((c) => [c.id, c.name]));
  const evMap = new Map(events.map((e) => [e.id, e]));

  type Row = {
    group: 'live' | 'today' | 'tomorrow' | 'later';
    label: string;
    home: string;
    away: string;
    competition: string;
    kickoff: Date;
    text: string;
    edge: number;
    kind?: string;
  };
  const rows: Row[] = [];

  for (const [, s] of best) {
    const ev = evMap.get(s.eventId);
    if (!ev) continue;
    const home = teamName.get(ev.homeTeamId) ?? '?';
    const away = teamName.get(ev.awayTeamId) ?? '?';
    const comp = compName.get(ev.competitionId) ?? '?';
    const payload = (s.payload ?? {}) as Record<string, unknown>;
    const sel = String(payload.selectionSlug ?? 'unknown');
    const kind = String(payload.kind ?? 'bet');
    const selText = shortSelection(sel, home, away);

    const { group, label } = classifyTime(ev.kickoffUtc);
    const team1 = home.length > 14 ? home.slice(0, 14) + '…' : home;
    const team2 = away.length > 14 ? away.slice(0, 14) + '…' : away;

    // Varia per kind
    let detail = `<b>${selText}</b>`;
    if (kind === 'price_change' && payload.previousOdd && payload.currentOdd) {
      const prev = Number(payload.previousOdd).toFixed(2);
      const curr = Number(payload.currentOdd).toFixed(2);
      const chg = (Number(payload.changePct) * 100).toFixed(1);
      detail = `<b>${selText}</b> ${prev}→${curr} <i>(${chg}%)</i>`;
    } else if (payload.bestBookOdd) {
      const bookOdd = Number(payload.bestBookOdd).toFixed(2);
      detail = `<b>${selText}</b> @ ${bookOdd}`;
    }

    const conf = payload.confidence ? ` · ${Math.round(Number(payload.confidence))}` : '';

    rows.push({
      group,
      label,
      home: team1,
      away: team2,
      competition: comp,
      kickoff: ev.kickoffUtc,
      text: `${team1}–${team2} ▸ ${detail}${conf}`,
      edge: s.edge,
      kind,
    });
  }

  // Filtra SOLO prematch (escludi live). Il promemoria è per partite future.
  const prematchRows = rows.filter((r) => r.group !== 'live');

  const groupOrder = { live: 0, today: 1, tomorrow: 2, later: 3 } as const;
  prematchRows.sort((a, b) => {
    const go = groupOrder[a.group] - groupOrder[b.group];
    if (go !== 0) return go;
    return a.kickoff.getTime() - b.kickoff.getTime();
  });

  const today = prematchRows.filter((r) => r.group === 'today');
  const tomorrow = prematchRows.filter((r) => r.group === 'tomorrow');
  const later = prematchRows.filter((r) => r.group === 'later');

  if (prematchRows.length === 0) {
    console.log('  no prematch signals in window, skip digest');
    return;
  }

  const nowStr = new Date().toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  });
  const windowFrom = new Date(Date.now() - WINDOW_MIN * 60_000).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Rome',
  });

  const MAX_PER_SECTION = 12;
  const sectionBlock = (title: string, items: Row[]): string => {
    if (items.length === 0) return '';
    const lines = items.slice(0, MAX_PER_SECTION).map((r) => `• ${r.text}`);
    const more = items.length > MAX_PER_SECTION ? `\n<i>+${items.length - MAX_PER_SECTION} altri…</i>` : '';
    return `\n<b>${title}</b>\n${lines.join('\n')}${more}`;
  };

  let body = `📋 <b>PROMEMORIA ${windowFrom}–${nowStr}</b>\n`;
  body += `<i>${prematchRows.length} segnali prematch</i>\n`;

  body += sectionBlock('🟢 OGGI', today);
  body += sectionBlock('🟡 DOMANI', tomorrow);
  body += sectionBlock('🔵 PROSSIMI', later);

  body += `\n\n<a href="${SITE_URL}/signals">Apri dashboard</a>`;

  const ok = await sendTelegram(body, { silent: true });
  console.log(`  ✓ digest sent=${ok} rows=${rows.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
