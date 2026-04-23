/**
 * Auto-disable job — scansiona per-kind WR storica e flagga in kind_disabled
 * i kind con WR < 38% su >= 20 risolti. Gira ogni 1h.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, schema } from '../src/lib/db';
import { computeSignalStats } from '../src/lib/signals/stats';

const MIN_RESOLVED = Number(process.env.KILL_MIN_RESOLVED ?? '20');
const MAX_WR = Number(process.env.KILL_MAX_WR ?? '0.38');

async function main() {
  console.log(`[${new Date().toISOString()}] === AUTO-DISABLE SCAN ===`);
  const stats = await computeSignalStats(30);

  const existing = await db.select().from(schema.kindDisabled);
  const existingSet = new Set(existing.filter((e) => !e.manual).map((e) => e.kindKey));

  const toDisable: Array<{ key: string; resolved: number; wr: number; reason: string }> = [];
  const toEnable: string[] = [];
  const currentlyBadKeys = new Set<string>();

  for (const t of stats.byType) {
    if (t.resolved < MIN_RESOLVED) continue;
    const key = `${t.type}${t.kind ? ':' + t.kind : ''}`;
    if (t.winRate < MAX_WR) {
      currentlyBadKeys.add(key);
      if (!existingSet.has(key)) {
        toDisable.push({
          key,
          resolved: t.resolved,
          wr: t.winRate,
          reason: `auto: ${t.resolved} risolti, WR ${(t.winRate * 100).toFixed(1)}% < ${MAX_WR * 100}%`,
        });
      }
    }
  }

  // Riabilita auto-disabled che ora performano bene (tranne manual)
  for (const e of existing) {
    if (e.manual) continue;
    if (!currentlyBadKeys.has(e.kindKey)) toEnable.push(e.kindKey);
  }

  for (const d of toDisable) {
    await db.insert(schema.kindDisabled).values({
      kindKey: d.key,
      reason: d.reason,
      resolvedCount: d.resolved,
      winRate: d.wr,
      manual: false,
    }).onConflictDoNothing();
    console.log(`  🚫 DISABLED: ${d.key} — ${d.reason}`);
  }

  for (const k of toEnable) {
    await db.execute(sql`DELETE FROM kind_disabled WHERE kind_key = ${k} AND manual = false`);
    console.log(`  ✅ RE-ENABLED: ${k} (performance migliorata)`);
  }

  console.log(`✓ disabled=+${toDisable.length} re-enabled=${toEnable.length}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
