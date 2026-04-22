import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth/auth';
import { getSetting, setSetting } from '@/lib/settings';

const schemaIn = z.object({ enabled: z.boolean() });

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const enabled = await getSetting<boolean>('notifications_enabled', true);
  return NextResponse.json({ enabled });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = schemaIn.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await setSetting('notifications_enabled', parsed.data.enabled);
  return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
}
