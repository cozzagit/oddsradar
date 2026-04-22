import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { value: unknown; ts: number }>();

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value as T;

  try {
    const [row] = await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, key))
      .limit(1);
    const value = (row?.value ?? fallback) as T;
    cache.set(key, { value, ts: Date.now() });
    return value;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db
    .insert(schema.appSettings)
    .values({ key, value: value as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: value as unknown as Record<string, unknown>, updatedAt: sql`NOW()` },
    });
  cache.delete(key);
}

export async function isNotificationsEnabled(): Promise<boolean> {
  const v = await getSetting<boolean>('notifications_enabled', true);
  return Boolean(v);
}
