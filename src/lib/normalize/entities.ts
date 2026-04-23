import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

/**
 * Normalize team name: rimuove prefissi/suffissi club comuni per migliorare
 * il matching cross-book (CA Boca Juniors vs Boca Juniors, Juventus FC vs
 * Juventus).
 */
function normalizeForMatch(name: string): string {
  let t = name.toLowerCase().trim();
  // Rimuove prefissi club (CA, CS, CD, SD, AC, ASD, FC, AFC)
  for (const prefix of ['ca ', 'cs ', 'cd ', 'sd ', 'ac ', 'asd ', 'fc ', 'afc ']) {
    if (t.startsWith(prefix)) t = t.slice(prefix.length);
  }
  // Rimuove suffissi club (FC, CF, AFC, SC)
  for (const suffix of [' fc', ' cf', ' afc', ' sc']) {
    if (t.endsWith(suffix)) t = t.slice(0, -suffix.length);
  }
  return t.trim();
}

export async function findOrCreateTeam(
  sportId: number,
  rawName: string,
): Promise<{ id: number; created: boolean }> {
  const normalized = rawName.trim();
  const lc = normalized.toLowerCase();
  const forMatch = normalizeForMatch(normalized);

  // 1. Exact alias match (lowercased)
  const [alias] = await db
    .select({ id: schema.teamAliases.teamId })
    .from(schema.teamAliases)
    .where(eq(sql`lower(${schema.teamAliases.alias})`, lc))
    .limit(1);
  if (alias) return { id: alias.id, created: false };

  // 2. Exact canonical match within sport
  const [existing] = await db
    .select({ id: schema.teams.id })
    .from(schema.teams)
    .where(
      and(
        eq(schema.teams.sportId, sportId),
        eq(sql`lower(${schema.teams.nameCanonical})`, lc),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .insert(schema.teamAliases)
      .values({ teamId: existing.id, alias: normalized, confidence: 1, verified: true })
      .onConflictDoNothing();
    return { id: existing.id, created: false };
  }

  // 3. Trigram similarity match (pg_trgm) sulle ALIAS esistenti.
  // Threshold 0.55 evita falsi positivi tipo "Barcelona" vs "Barcelona B".
  // Confronto su forma normalizzata per catturare CA Boca vs Boca.
  if (forMatch.length >= 4) {
    const trgmMatches = await db.execute(
      sql`
        SELECT DISTINCT ta.team_id as id,
               similarity(lower(ta.alias), ${forMatch}) as score,
               t.name_canonical
        FROM team_aliases ta
        JOIN teams t ON t.id = ta.team_id
        WHERE t.sport_id = ${sportId}
          AND similarity(lower(ta.alias), ${forMatch}) > 0.55
        ORDER BY score DESC
        LIMIT 1
      `,
    );
    const row = (trgmMatches as unknown as { rows: Array<{ id: number; score: number }> }).rows?.[0]
      ?? (trgmMatches as unknown as Array<{ id: number; score: number }>)[0];
    if (row && row.id) {
      await db
        .insert(schema.teamAliases)
        .values({
          teamId: row.id,
          alias: normalized,
          confidence: Number(row.score) || 0.6,
          verified: false,
        })
        .onConflictDoNothing();
      return { id: row.id, created: false };
    }
  }

  // 4. Nuovo team
  const [created] = await db
    .insert(schema.teams)
    .values({ sportId, nameCanonical: normalized })
    .returning({ id: schema.teams.id });
  await db
    .insert(schema.teamAliases)
    .values({ teamId: created.id, alias: normalized, confidence: 1, verified: true });
  return { id: created.id, created: true };
}

export async function findOrCreateCompetition(
  sportId: number,
  name: string,
): Promise<number> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [existing] = await db
    .select({ id: schema.competitions.id })
    .from(schema.competitions)
    .where(
      and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.slug, slug)),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.competitions)
    .values({ sportId, slug, name })
    .returning({ id: schema.competitions.id });
  return created.id;
}

export async function findOrCreateEvent(
  competitionId: number,
  homeTeamId: number,
  awayTeamId: number,
  kickoffUtc: Date,
): Promise<number> {
  const [existing] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.competitionId, competitionId),
        eq(schema.events.homeTeamId, homeTeamId),
        eq(schema.events.awayTeamId, awayTeamId),
        eq(schema.events.kickoffUtc, kickoffUtc),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.events)
    .values({ competitionId, homeTeamId, awayTeamId, kickoffUtc })
    .onConflictDoNothing()
    .returning({ id: schema.events.id });
  if (created) return created.id;
  // race: re-read
  const [again] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.competitionId, competitionId),
        eq(schema.events.homeTeamId, homeTeamId),
        eq(schema.events.awayTeamId, awayTeamId),
        eq(schema.events.kickoffUtc, kickoffUtc),
      ),
    );
  return again.id;
}

/** Map The Odds API market + outcome names to our (market_id, selection_id). */
export function toaMarketSelection(
  markets: Array<{ id: number; slug: string }>,
  selections: Array<{ id: number; slug: string; marketId: number }>,
  toaMarketKey: string,
  outcomeName: string,
  homeTeamName: string,
  awayTeamName: string,
): { marketId: number; selectionId: number } | null {
  if (toaMarketKey === 'h2h') {
    const market = markets.find((m) => m.slug === 'match_1x2');
    if (!market) return null;
    const n = outcomeName.trim();
    const nLow = n.toLowerCase();
    let selSlug: string | null = null;
    // Accept both pre-normalized slugs ('home'/'draw'/'away') and team names
    if (nLow === 'home' || n === homeTeamName) selSlug = 'home';
    else if (nLow === 'away' || n === awayTeamName) selSlug = 'away';
    else if (nLow === 'draw' || /^draw$/i.test(n)) selSlug = 'draw';
    if (!selSlug) return null;
    const sel = selections.find((s) => s.marketId === market.id && s.slug === selSlug);
    if (!sel) return null;
    return { marketId: market.id, selectionId: sel.id };
  }
  if (toaMarketKey === 'totals') {
    const market = markets.find((m) => m.slug === 'over_under_2_5');
    if (!market) return null;
    const n = outcomeName.trim().toLowerCase();
    const selSlug = n === 'over' || n.startsWith('over') ? 'over'
      : n === 'under' || n.startsWith('under') ? 'under' : null;
    if (!selSlug) return null;
    const sel = selections.find((s) => s.marketId === market.id && s.slug === selSlug);
    if (!sel) return null;
    return { marketId: market.id, selectionId: sel.id };
  }
  return null;
}
