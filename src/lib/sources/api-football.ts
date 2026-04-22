/**
 * API-Football (via RapidAPI) — fixtures live + odds prematch/live.
 * Docs: https://www.api-football.com/documentation-v3
 *
 * Rate limit: dipende dal piano RapidAPI. Free 100 req/day.
 * Implementiamo rate-limit soft: ~6s tra chiamate.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = 'api-football-v1.p.rapidapi.com';
const BASE = `https://${HOST}/v3`;

function apiKey(): string {
  const k = process.env.RAPIDAPI_KEY;
  if (!k) throw new Error('Missing RAPIDAPI_KEY in env');
  return k;
}

async function afFetch<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      'x-rapidapi-host': HOST,
      'x-rapidapi-key': apiKey(),
    },
  });
  const remaining = r.headers.get('x-ratelimit-requests-remaining');
  if (remaining) console.log(`  AF quota rest: ${remaining}`);
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`api-football ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()) as T;
}

// ─────────── Types (solo i campi che usiamo) ───────────
export interface AFFixture {
  fixture: {
    id: number;
    date: string;
    timezone: string;
    status: { short: string; long: string; elapsed: number | null };
    timestamp: number;
  };
  league: { id: number; name: string; country: string; season: number };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals?: { home: number | null; away: number | null };
}

export interface AFOddsBookmaker {
  id: number;
  name: string;
  bets: Array<{
    id: number;
    name: string;
    values: Array<{ value: string; odd: string; handicap?: string; main?: boolean; suspended?: boolean }>;
  }>;
}

export interface AFOddsItem {
  fixture: { id: number };
  league: { id: number; season: number };
  bookmakers: AFOddsBookmaker[];
}

// ─────────── Bookmaker mapping (id API-Football → slug OddsRadar) ───────────
export const AF_BOOK_MAP: Record<number, { slug: string; tier: 'sharp' | 'soft' | 'minor' }> = {
  2: { slug: 'marathonbet', tier: 'sharp' },
  3: { slug: 'betfair_ex', tier: 'sharp' },
  4: { slug: 'pinnacle', tier: 'sharp' },
  5: { slug: 'sbobet', tier: 'sharp' },
  6: { slug: 'bwin', tier: 'soft' },
  7: { slug: 'williamhill', tier: 'soft' },
  8: { slug: 'bet365', tier: 'soft' },
  9: { slug: 'dafabet', tier: 'minor' },
  11: { slug: '1xbet', tier: 'minor' },
  13: { slug: '188bet', tier: 'minor' },
  15: { slug: 'interwetten', tier: 'minor' },
  16: { slug: 'unibet', tier: 'soft' },
  21: { slug: '888sport', tier: 'soft' },
  22: { slug: 'tipico', tier: 'soft' },
  24: { slug: 'betway', tier: 'soft' },
  26: { slug: 'betsson', tier: 'soft' },
  32: { slug: 'betano', tier: 'minor' },
  33: { slug: 'fonbet', tier: 'minor' },
  34: { slug: 'superbet', tier: 'minor' },
};

// Leghe interessanti (id → nostra competition_name)
export const AF_LEAGUES: Array<{ id: number; name: string; country?: string }> = [
  { id: 135, name: 'Serie A', country: 'ITA' },
  { id: 136, name: 'Serie B', country: 'ITA' },
  { id: 39, name: 'Premier League', country: 'ENG' },
  { id: 140, name: 'La Liga', country: 'ESP' },
  { id: 78, name: 'Bundesliga', country: 'GER' },
  { id: 61, name: 'Ligue 1', country: 'FRA' },
  { id: 2, name: 'UEFA Champions League' },
  { id: 3, name: 'UEFA Europa League' },
  { id: 848, name: 'UEFA Conference League' },
  { id: 88, name: 'Eredivisie', country: 'NED' },
  { id: 94, name: 'Primeira Liga', country: 'POR' },
];

// ─────────── Endpoints ───────────
export async function fetchLiveFixtures(): Promise<AFFixture[]> {
  const res = await afFetch<{ response: AFFixture[] }>('/fixtures?live=all');
  return res.response;
}

export async function fetchLiveOdds(): Promise<AFOddsItem[]> {
  const res = await afFetch<{ response: AFOddsItem[] }>('/odds/live');
  return res.response;
}

export async function fetchPrematchOdds(leagueId: number, season: number): Promise<AFOddsItem[]> {
  const res = await afFetch<{ response: AFOddsItem[] }>(
    `/odds?league=${leagueId}&season=${season}&bet=1`, // bet=1 = Match Winner 1X2
  );
  return res.response;
}

export async function fetchFixturesForLeagueDateRange(
  leagueId: number,
  season: number,
  from: string,
  to: string,
): Promise<AFFixture[]> {
  const res = await afFetch<{ response: AFFixture[] }>(
    `/fixtures?league=${leagueId}&season=${season}&from=${from}&to=${to}`,
  );
  return res.response;
}

/**
 * Normalizza un AF odds market name + outcome in (market_slug, selection_slug).
 * Supporto iniziale: Match Winner (1X2), Goals Over/Under 2.5.
 */
export function mapAfMarket(
  marketName: string,
  outcomeValue: string,
  handicap: string | undefined,
  homeTeamName: string,
  awayTeamName: string,
): { marketSlug: string; selectionSlug: string } | null {
  const m = marketName.toLowerCase();
  const v = outcomeValue.trim();

  if (m === 'match winner' || m === 'full time result' || m === '1x2' || m === 'fulltime result') {
    if (v === 'Home' || v === '1' || v === homeTeamName) return { marketSlug: 'match_1x2', selectionSlug: 'home' };
    if (v === 'Away' || v === '2' || v === awayTeamName) return { marketSlug: 'match_1x2', selectionSlug: 'away' };
    if (/^(draw|x)$/i.test(v)) return { marketSlug: 'match_1x2', selectionSlug: 'draw' };
    return null;
  }

  if (m === 'goals over/under' || m === 'over/under' || m === 'total goals') {
    const line = handicap ?? '';
    if (!line.includes('2.5')) return null;
    if (/^over$/i.test(v)) return { marketSlug: 'over_under_2_5', selectionSlug: 'over' };
    if (/^under$/i.test(v)) return { marketSlug: 'over_under_2_5', selectionSlug: 'under' };
    return null;
  }

  return null;
}

/** Polite sleep helper, usa per batch di chiamate. */
export async function afDelay(ms = 6500): Promise<void> {
  await sleep(ms);
}
