/**
 * TheOddsAPI client con pool di chiavi e rotazione automatica.
 * - Legge THE_ODDS_API_KEYS (comma-separated) o fallback THE_ODDS_API_KEY.
 * - Cicla alle chiavi residue quando una risponde OUT_OF_USAGE_CREDITS.
 * - Traccia in memoria quali chiavi sono "bruciate" per il resto del run.
 */

const BASE = 'https://api.the-odds-api.com/v4';

interface KeyState {
  key: string;
  exhausted: boolean;
  lastRemaining?: number;
}

let POOL: KeyState[] | null = null;
let currentIndex = 0;

function loadPool(): KeyState[] {
  if (POOL) return POOL;
  const multi = (process.env.THE_ODDS_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const single = (process.env.THE_ODDS_API_KEY ?? '').trim();
  const all = [...new Set([...multi, single].filter(Boolean))];
  POOL = all.map((key) => ({ key, exhausted: false }));
  if (POOL.length === 0) {
    console.warn('[toa] no API keys configured');
  } else {
    console.log(`[toa] pool loaded: ${POOL.length} key(s)`);
  }
  return POOL;
}

function pickKey(): KeyState | null {
  const pool = loadPool();
  if (pool.length === 0) return null;
  for (let i = 0; i < pool.length; i++) {
    const idx = (currentIndex + i) % pool.length;
    if (!pool[idx].exhausted) {
      currentIndex = idx;
      return pool[idx];
    }
  }
  return null;
}

function markExhausted(state: KeyState): void {
  state.exhausted = true;
  console.warn(`[toa] key ${maskKey(state.key)} EXHAUSTED — rotating`);
  currentIndex = (currentIndex + 1) % Math.max(1, loadPool().length);
}

function maskKey(k: string): string {
  return k.length < 8 ? '***' : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export interface ToaFetchResult<T> {
  data: T;
  keyUsed: string;
  remaining: number | null;
}

export async function toaFetch<T>(path: string, query: Record<string, string> = {}): Promise<ToaFetchResult<T> | null> {
  const pool = loadPool();
  if (pool.length === 0) return null;

  const attempts = pool.length;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = pickKey();
    if (!state) break;

    const qs = new URLSearchParams({ ...query, apiKey: state.key }).toString();
    const url = `${BASE}${path}?${qs}`;
    const r = await fetch(url);

    const remaining = Number(r.headers.get('x-requests-remaining') ?? 'NaN');
    state.lastRemaining = Number.isFinite(remaining) ? remaining : state.lastRemaining;

    if (r.status === 401 || r.status === 429) {
      const body = await r.text();
      if (body.includes('OUT_OF_USAGE_CREDITS') || r.status === 429) {
        markExhausted(state);
        continue; // prova la prossima chiave
      }
      console.warn(`[toa] HTTP ${r.status} on ${path}: ${body.slice(0, 180)}`);
      return null;
    }
    if (!r.ok) {
      console.warn(`[toa] HTTP ${r.status} on ${path}`);
      return null;
    }

    const data = (await r.json()) as T;
    if (Number.isFinite(remaining)) {
      console.log(`  [toa key ${maskKey(state.key)}] quota rest: ${remaining}`);
    }
    return { data, keyUsed: maskKey(state.key), remaining: Number.isFinite(remaining) ? remaining : null };
  }

  console.warn('[toa] all keys exhausted');
  return null;
}

export async function fetchSportOdds(
  sportKey: string,
  opts: { regions?: string; markets?: string } = {},
): Promise<ToaFetchResult<unknown[]> | null> {
  return toaFetch(`/sports/${sportKey}/odds`, {
    regions: opts.regions ?? 'eu,uk,us,au',
    markets: opts.markets ?? 'h2h,totals',
    oddsFormat: 'decimal',
  });
}

export function poolStatus(): Array<{ key: string; exhausted: boolean; lastRemaining?: number }> {
  return loadPool().map((s) => ({ key: maskKey(s.key), exhausted: s.exhausted, lastRemaining: s.lastRemaining }));
}
