import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { isAllowedLeague } from '@/lib/signals/league-filter';

// In-memory cache dei kind disabled (TTL 60s)
let disabledCache: { set: Set<string>; ts: number } | null = null;
// Cache event_id → competition_name (TTL 10min)
const eventCompCache = new Map<number, { name: string; ts: number }>();
const EVENT_COMP_TTL = 10 * 60_000;

async function getEventCompetition(eventId: number): Promise<string> {
  const hit = eventCompCache.get(eventId);
  if (hit && Date.now() - hit.ts < EVENT_COMP_TTL) return hit.name;
  try {
    const [row] = await db
      .select({ name: schema.competitions.name })
      .from(schema.events)
      .innerJoin(schema.competitions, eq(schema.competitions.id, schema.events.competitionId))
      .where(eq(schema.events.id, eventId))
      .limit(1);
    const name = row?.name ?? '';
    eventCompCache.set(eventId, { name, ts: Date.now() });
    return name;
  } catch {
    return '';
  }
}

async function getDisabledKinds(): Promise<Set<string>> {
  if (disabledCache && Date.now() - disabledCache.ts < 60_000) return disabledCache.set;
  try {
    const rows = await db.select({ k: schema.kindDisabled.kindKey }).from(schema.kindDisabled);
    const set = new Set(rows.map((r) => r.k));
    disabledCache = { set, ts: Date.now() };
    return set;
  } catch {
    return new Set();
  }
}

const DEFAULT_DEDUP_MS = 60 * 60_000; // 60 min

interface PersistInput {
  type: 'arb' | 'value' | 'steam' | 'bet';
  eventId: number;
  marketId: number;
  selectionId?: number;
  edge: number;
  payload: Record<string, unknown>;
  expiresAt: Date;
  dedupWindowMs?: number; // override (es. live price-change 10 min)
}

/** Returns id of new signal or null if a recent duplicate already exists. */
export async function persistSignalIfNew(input: PersistInput): Promise<number | null> {
  // League whitelist: solo top europei
  const competition = await getEventCompetition(input.eventId);
  if (!isAllowedLeague(competition)) return null;

  // Kill-switch check
  const kind = (input.payload?.kind as string) ?? null;
  const kindKey = `${input.type}${kind ? ':' + kind : ''}`;
  const disabled = await getDisabledKinds();
  if (disabled.has(kindKey)) return null;

  const windowMs = input.dedupWindowMs ?? DEFAULT_DEDUP_MS;
  const sinceTs = new Date(Date.now() - windowMs);
  // Dedup guarda TUTTI i signal (active o expired) recenti per evitare
  // che un signal expired dopo pochi minuti venga ri-generato.
  const conditions = [
    eq(schema.signals.eventId, input.eventId),
    eq(schema.signals.marketId, input.marketId),
    eq(schema.signals.type, input.type),
    gte(schema.signals.createdAt, sinceTs),
  ];
  if (input.selectionId != null) {
    conditions.push(eq(schema.signals.selectionId, input.selectionId));
  }
  const existing = await db
    .select({ id: schema.signals.id })
    .from(schema.signals)
    .where(and(...conditions))
    .limit(1);
  if (existing.length > 0) return null;

  const [row] = await db
    .insert(schema.signals)
    .values({
      type: input.type,
      eventId: input.eventId,
      marketId: input.marketId,
      selectionId: input.selectionId,
      edge: input.edge,
      payload: input.payload,
      expiresAt: input.expiresAt,
    })
    .returning({ id: schema.signals.id });
  return row.id;
}

export async function expireOldSignals(): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(schema.signals)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.signals.status, 'active'),
        isNotNull(schema.signals.expiresAt),
        lte(schema.signals.expiresAt, now),
      ),
    )
    .returning({ id: schema.signals.id });
  return rows.length;
}
