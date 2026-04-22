import Link from 'next/link';
import { aliasedTable, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import {
  buildActionableArb,
  buildActionableValue,
  type ArbLeg,
} from '@/lib/signals/actionable';

export const dynamic = 'force-dynamic';

function fmtKickoff(d: Date) {
  return d.toLocaleString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relKickoff(d: Date): string {
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff < 0) return 'in corso / passato';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `tra ${Math.max(1, Math.floor(diff / 60_000))} min`;
  if (h < 24) return `tra ${h}h`;
  return `tra ${Math.floor(h / 24)}g ${h % 24}h`;
}

export default async function SignalsPage() {
  const homeTeams = aliasedTable(schema.teams, 'home_teams');
  const awayTeams = aliasedTable(schema.teams, 'away_teams');

  const rows = await db
    .select({
      id: schema.signals.id,
      type: schema.signals.type,
      edge: schema.signals.edge,
      payload: schema.signals.payload,
      createdAt: schema.signals.createdAt,
      expiresAt: schema.signals.expiresAt,
      eventId: schema.events.id,
      competition: schema.competitions.name,
      kickoff: schema.events.kickoffUtc,
      home: homeTeams.nameCanonical,
      away: awayTeams.nameCanonical,
      marketSlug: schema.markets.slug,
      marketName: schema.markets.name,
    })
    .from(schema.signals)
    .innerJoin(schema.events, eq(schema.events.id, schema.signals.eventId))
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
    .innerJoin(homeTeams, eq(homeTeams.id, schema.events.homeTeamId))
    .innerJoin(awayTeams, eq(awayTeams.id, schema.events.awayTeamId))
    .leftJoin(schema.markets, eq(schema.markets.id, schema.signals.marketId))
    .where(eq(schema.signals.status, 'active'))
    .orderBy(desc(schema.signals.edge), desc(schema.signals.createdAt))
    .limit(100);

  return (
    <section className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Cosa scommettere oggi</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Opportunità rilevate confrontando quote tra molti bookmaker. Ordinate per vantaggio.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-400">
          Nessun segnale attivo al momento. Lancia{' '}
          <code className="rounded bg-zinc-800 px-1">npm run ingest:now</code> per popolare.
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const payload = r.payload as Record<string, unknown>;
            const isArb = r.type === 'arb';
            const isValue = r.type === 'value';

            return (
              <li
                key={r.id}
                className={
                  'rounded-xl border-2 bg-zinc-900/60 overflow-hidden transition hover:bg-zinc-900 ' +
                  (isArb
                    ? 'border-cyan-700/60'
                    : isValue
                    ? 'border-emerald-700/60'
                    : 'border-amber-700/60')
                }
              >
                {/* Header: tipo + evento */}
                <div className="border-b border-zinc-800 bg-zinc-950/60 px-4 py-3">
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span
                      className={
                        isArb
                          ? 'rounded-full bg-cyan-500 px-2 py-0.5 font-bold uppercase text-zinc-950'
                          : isValue
                          ? 'rounded-full bg-emerald-500 px-2 py-0.5 font-bold uppercase text-zinc-950'
                          : 'rounded-full bg-amber-500 px-2 py-0.5 font-bold uppercase text-zinc-950'
                      }
                    >
                      {isArb ? 'Arbitraggio' : isValue ? 'Value bet' : 'Steam'}
                    </span>
                    <span className="text-zinc-500">
                      {r.competition} · {r.marketName ?? ''}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/events/${r.eventId}`}
                      className="text-lg font-semibold hover:underline"
                    >
                      {r.home} <span className="text-zinc-500">vs</span> {r.away}
                    </Link>
                    <span className="whitespace-nowrap text-xs text-zinc-500">
                      {fmtKickoff(r.kickoff)} · {relKickoff(r.kickoff)}
                    </span>
                  </div>
                </div>

                {/* Corpo azionabile */}
                {isArb && <ArbCard legs={payload.legs as ArbLeg[]} edge={r.edge} home={r.home} away={r.away} />}
                {isValue && (
                  <ValueCard
                    bookSlug={String(payload.bookSlug)}
                    selSlug={String(payload.selectionSlug)}
                    offeredOdd={Number(payload.offeredOdd)}
                    fairOdd={Number(payload.fairOdd)}
                    fairProb={Number(payload.fairProb)}
                    edge={r.edge}
                    home={r.home}
                    away={r.away}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <details className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-300">
        <summary className="cursor-pointer font-semibold text-zinc-100">
          Come leggere i segnali
        </summary>
        <div className="mt-3 space-y-3 text-zinc-400">
          <p>
            <strong className="text-cyan-300">ARBITRAGGIO</strong> — giochi contemporaneamente su
            book diversi tutte e 3 le uscite (1/X/2 o Over/Under). Qualunque risultato esca,
            incassi sempre più di quanto hai messo. Ti diciamo noi quanto puntare su ognuna.
          </p>
          <p>
            <strong className="text-emerald-300">VALUE BET</strong> — un singolo book ha
            sbagliato la quota, pagandoti di più di quanto il risultato vale veramente (secondo i
            book più efficienti del mondo: Pinnacle, Betfair Exchange, Smarkets). Giochi una
            puntata singola, non è garantita ma è matematicamente conveniente nel lungo periodo.
          </p>
          <p>
            <strong className="text-amber-300">STEAM</strong> (Sprint 2) — la quota si sta
            muovendo in modo sospetto su più book: segnale di informazione "smart money"
            (infortuni, line-up, insider). Ti conviene giocare PRIMA che la quota si allinei.
          </p>
          <p className="text-xs italic text-zinc-500">
            Il tool è uno strumento analitico: decidi tu se e quanto puntare. Scommetti con
            moderazione.
          </p>
        </div>
      </details>
    </section>
  );
}

function ArbCard({
  legs,
  edge,
  home,
  away,
}: {
  legs: ArbLeg[];
  edge: number;
  home: string;
  away: string;
}) {
  const STAKE_EUR = 100;
  const act = buildActionableArb(legs, edge, home, away, STAKE_EUR);

  const feasBadge =
    act.feasibility === 'easy'
      ? { bg: 'bg-emerald-500/20', fg: 'text-emerald-300', label: 'facile' }
      : act.feasibility === 'hard'
      ? { bg: 'bg-red-500/20', fg: 'text-red-300', label: 'difficile' }
      : { bg: 'bg-amber-500/20', fg: 'text-amber-300', label: 'medio' };

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Profitto garantito</div>
          <div className="text-3xl font-bold text-cyan-400">
            +€{act.guaranteedProfit.toFixed(2)}
            <span className="ml-2 text-base text-cyan-300">({act.guaranteedProfitPct}%)</span>
          </div>
          <div className="text-xs text-zinc-500">su €{STAKE_EUR} totali scommessi</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${feasBadge.bg} ${feasBadge.fg}`}>
          {feasBadge.label}
        </span>
      </div>

      <div className="rounded-lg bg-zinc-950/50 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Come scommettere</div>
        <div className="space-y-2">
          {act.legs.map((l, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md bg-zinc-900 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{l.label}</div>
                <div className="text-xs text-zinc-500">
                  su <span className="text-zinc-300">{l.bookName}</span> @ {l.odd.toFixed(2)}
                </div>
              </div>
              <div className="ml-3 text-right">
                <div className="text-lg font-bold text-cyan-300">€{l.stake.toFixed(2)}</div>
                <div className="text-xs text-zinc-500">→ €{l.return.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-xs text-zinc-500">{act.feasibilityReason}</p>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-zinc-500">
          Perché funziona
        </summary>
        <p className="mt-2 text-zinc-400">
          La somma delle probabilità implicite delle 3 quote scelte è &lt; 100% (mercato sbilanciato
          tra book). Distribuendo lo stake in proporzione inversa alla quota, qualunque esito
          produce lo stesso ritorno, superiore all&apos;investimento.
        </p>
      </details>
    </div>
  );
}

function ValueCard({
  bookSlug,
  selSlug,
  offeredOdd,
  fairOdd,
  fairProb,
  edge,
  home,
  away,
}: {
  bookSlug: string;
  selSlug: string;
  offeredOdd: number;
  fairOdd: number;
  fairProb: number;
  edge: number;
  home: string;
  away: string;
}) {
  const act = buildActionableValue(
    bookSlug,
    selSlug,
    offeredOdd,
    fairOdd,
    fairProb,
    edge,
    home,
    away,
  );

  return (
    <div className="px-4 py-4">
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Puntata consigliata</div>
        <div className="mt-1 text-2xl font-bold">
          {act.label} <span className="text-zinc-500">@</span>{' '}
          <span className="font-mono text-emerald-400">{act.offeredOdd.toFixed(2)}</span>
        </div>
        <div className="text-sm text-zinc-400">
          su <span className="font-semibold text-zinc-200">{act.bookName}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Vantaggio atteso" value={`+${act.edgePct}%`} accent="emerald" />
        <Stat label="Stake suggerito" value={`${act.suggestedStakePctBankroll}%`} sub="del bankroll" />
        <Stat
          label="Prob. reale stimata"
          value={`${(act.fairProb * 100).toFixed(1)}%`}
          sub={`quota "giusta": ${act.fairOdd.toFixed(2)}`}
        />
      </div>

      <p className="mt-4 rounded-md bg-zinc-950/50 p-3 text-sm leading-relaxed text-zinc-300">
        {act.reasoning}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'emerald' | 'cyan';
}) {
  const accentClass = accent === 'emerald' ? 'text-emerald-400' : accent === 'cyan' ? 'text-cyan-400' : 'text-zinc-100';
  return (
    <div className="rounded-md bg-zinc-950/50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-bold ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  );
}
