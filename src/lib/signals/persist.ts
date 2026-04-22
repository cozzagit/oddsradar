import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const DEDUP_WINDOW_MS = 15 * 60_000;

interface PersistInput {
  type: 'arb' | 'value' | 'steam' | 'bet';
  eventId: number;
  marketId: number;
  selectionId?: number;
  edge: number;
  payload: Record<string, unknown>;
  expiresAt: Date;
}

/** Returns id of new signal or null if a recent duplicate already exists. */
export async function persistSignalIfNew(input: PersistInput): Promise<number | null> {
  const sinceTs = new Date(Date.now() - DEDUP_WINDOW_MS);
  const conditions = [
    eq(schema.signals.eventId, input.eventId),
    eq(schema.signals.marketId, input.marketId),
    eq(schema.signals.type, input.type),
    eq(schema.signals.status, 'active'),
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
