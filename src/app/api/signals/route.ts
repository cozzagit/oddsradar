import { NextResponse } from 'next/server';
import { desc, eq, and, gte, inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.getAll('type');
  const minEdge = Number(url.searchParams.get('minEdge') ?? '0');
  const since = url.searchParams.get('since');

  const conditions = [eq(schema.signals.status, 'active'), gte(schema.signals.edge, minEdge)];
  if (type.length > 0) {
    conditions.push(inArray(schema.signals.type, type as Array<'arb' | 'value' | 'steam'>));
  }
  if (since) {
    conditions.push(gte(schema.signals.createdAt, new Date(since)));
  }

  const rows = await db
    .select()
    .from(schema.signals)
    .where(and(...conditions))
    .orderBy(desc(schema.signals.createdAt))
    .limit(100);

  return NextResponse.json({
    data: rows,
    meta: { version: 'v1', count: rows.length },
  });
}
