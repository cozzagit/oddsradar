/**
 * Resolver — per ogni signal del giorno precedente (kickoff passato da > 3h)
 * con outcome=pending, recupera score finale da API-Football e calcola
 * won/lost/void. Simula profit con stake €10 fisso + bankroll €1000.
 */
import 'dotenv/config';
import { and, eq, gt, lt, inArray } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import { resolveOutcome, simulateProfit, type Outcome } from '../src/lib/signals/resolver';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const SIM_STAKE = Number(process.env.SIM_STAKE_EUR ?? '10');
const LOOKBACK_DAYS = Number(process.env.RESOLVER_LOOKBACK_DAYS ?? '3');

type AfFixture = {
  fixture: { id: number; date: string; status: { short: string; long: string } };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
  league: { id: number; season: number; name: string };
};

async function fetchAfFixturesByDate(date: string): Promise<AfFixture[]> {
  if (!RAPIDAPI_KEY) return [];
  const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${date}&status=FT-AET-PEN`;
  const r = await fetch(url, {
    headers: {
      'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
      'x-rapidapi-key': RAPIDAPI_KEY,
    },
  });
  if (!r.ok) {
    console.warn(`  AF ${r.status} on ${date}`);
    return [];
  }
  const rem = r.headers.get('x-ratelimit-requests-remaining');
  if (rem) console.log(`  AF quota rest: ${rem}`);
  const j = (await r.json()) as { response?: AfFixture[] };
  return j.response ?? [];
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*fc\s*$/, '')
    .replace(/^ca\s+/, '')
    .replace(/^cd\s+/, '')
    .replace(/^sd\s+/, '')
    .replace(/^ac\s+/, '')
    .trim();
}

function teamMatches(dbName: string, afName: string): boolean {
  const a = normalizeTeam(dbName);
  const b = normalizeTeam(afName);
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aw = new Set(a.split(' ').filter((w) => w.length > 3));
  const bw = new Set(b.split(' ').filter((w) => w.length > 3));
  const common = [...aw].filter((w) => bw.has(w));
  return common.length > 0;
}

async function main() {
  const t0 = Date.now();
  console.log(`[${new Date().toISOString()}] === RESOLVER ===`);

  // Prendi signals con kickoff passato da almeno 3h, ancora pending
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000);
  const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);

  const pending = await db
    .select({
      id: schema.signals.id,
      type: schema.signals.type,
      eventId: schema.signals.eventId,
      marketId: schema.signals.marketId,
      selectionId: schema.signals.selectionId,
      payload: schema.signals.payload,
      createdAt: schema.signals.createdAt,
    })
    .from(schema.signals)
    .innerJoin(schema.events, eq(schema.events.id, schema.signals.eventId))
    .where(
      and(
        eq(schema.signals.outcome, 'pending'),
        lt(schema.events.kickoffUtc, cutoff),
        gt(schema.events.kickoffUtc, lookback),
      ),
    );

  console.log(`  pending signals: ${pending.length}`);
  if (pending.length === 0) return;

  // Group by date per fetch API
  const evIds = Array.from(new Set(pending.map((p) => p.eventId)));
  const events = await db
    .select()
    .from(schema.events)
    .where(inArray(schema.events.id, evIds));
  const teams = await db.select().from(schema.teams);
  const teamById = new Map(teams.map((t) => [t.id, t.nameCanonical]));

  // Dates to fetch (YYYY-MM-DD)
  const dates = new Set<string>();
  for (const ev of events) {
    const d = ev.kickoffUtc;
    dates.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }

  const fixturesByDate = new Map<string, AfFixture[]>();
  for (const date of dates) {
    const fx = await fetchAfFixturesByDate(date);
    fixturesByDate.set(date, fx);
    await new Promise((r) => setTimeout(r, 6_500));
  }

  const markets = await db.select().from(schema.markets);
  const selections = await db.select().from(schema.selections);
  const marketById = new Map(markets.map((m) => [m.id, m]));
  const selectionById = new Map(selections.map((s) => [s.id, s]));

  let resolved = 0;
  let unresolved = 0;

  for (const p of pending) {
    const ev = events.find((e) => e.id === p.eventId);
    if (!ev) continue;
    const home = teamById.get(ev.homeTeamId) ?? '';
    const away = teamById.get(ev.awayTeamId) ?? '';
    const d = ev.kickoffUtc;
    const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const fixtures = fixturesByDate.get(dateKey) ?? [];

    const match = fixtures.find(
      (f) =>
        sameDay(new Date(f.fixture.date), d) &&
        teamMatches(home, f.teams.home.name) &&
        teamMatches(away, f.teams.away.name),
    );

    if (!match || match.goals.home == null || match.goals.away == null) {
      unresolved++;
      continue;
    }

    const market = p.marketId ? marketById.get(p.marketId) : null;
    const sel = p.selectionId ? selectionById.get(p.selectionId) : null;
    if (!market || !sel) {
      unresolved++;
      continue;
    }

    const outcome: Outcome = resolveOutcome(market.slug, sel.slug, match.goals.home, match.goals.away);
    const payload = p.payload as Record<string, unknown>;
    const odd = Number(payload.marketMedianOdd ?? payload.bestBookOdd ?? payload.fairOdd ?? 0);
    const profit = simulateProfit(SIM_STAKE, odd, outcome);

    await db
      .update(schema.signals)
      .set({
        outcome,
        resolvedAt: new Date(),
        actualScoreHome: match.goals.home,
        actualScoreAway: match.goals.away,
        simulatedStake: SIM_STAKE,
        simulatedProfit: profit,
      })
      .where(eq(schema.signals.id, p.id));
    resolved++;
  }

  console.log(`  ✓ resolved=${resolved} unresolved=${unresolved} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
