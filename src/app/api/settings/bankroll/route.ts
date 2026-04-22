import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@/lib/auth/auth';
import { db, schema } from '@/lib/db';

const schemaIn = z.object({ bankrollEur: z.number().positive().max(10_000_000) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schemaIn.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await db
    .update(schema.users)
    .set({ bankrollEur: parsed.data.bankrollEur })
    .where(eq(schema.users.id, Number(session.user.id)));
  return NextResponse.json({ ok: true });
}
