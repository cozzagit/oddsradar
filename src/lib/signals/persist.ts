import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

export interface PersistArbInput {
  eventId: number;
  marketId: number;
  edge: number;
  payload: Record<string, unknown>;
  expiresAt: Date;
}

export interface PersistValueInput extends PersistArbInput {
  selectionId: number;
  bookId: number;
}

const DEDUP_WINDOW_MS = 15 * 60_000;

/** Returns id of new signal or null if a recent duplicate already exists. */
export async function persistArbSignalIfNew(input: PersistArbInput): Promise<number | null> {
  const sinceTs = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await db
    .select({ id: schema.signals.id })
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.eventId, input.eventId),
        eq(schema.signals.marketId, input.marketId),
        eq(schema.signals.type, 'arb'),
        eq(schema.signals.status, 'active'),
        gte(schema.signals.createdAt, sinceTs),
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;

  const [row] = await db
    .insert(schema.signals)
    .values({
      type: 'arb',
      eventId: input.eventId,
      marketId: input.marketId,
      edge: input.edge,
      payload: input.payload,
      expiresAt: input.expiresAt,
    })
    .returning({ id: schema.signals.id });
  return row.id;
}

export async function persistValueSignalIfNew(input: PersistValueInput): Promise<number | null> {
  const sinceTs = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await db
    .select({ id: schema.signals.id })
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.eventId, input.eventId),
        eq(schema.signals.marketId, input.marketId),
        eq(schema.signals.selectionId, input.selectionId),
        eq(schema.signals.type, 'value'),
        eq(schema.signals.status, 'active'),
        gte(schema.signals.createdAt, sinceTs),
      ),
    )
    .limit(1);
  if (existing.length > 0) return null;

  const [row] = await db
    .insert(schema.signals)
    .values({
      type: 'value',
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

/** Mark signals as expired if expires_at is in the past. */
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
