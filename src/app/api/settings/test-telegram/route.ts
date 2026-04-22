import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { sendTelegram, telegramEnabled } from '@/lib/notify/telegram';

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!telegramEnabled()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 400 });
  }
  const ok = await sendTelegram(
    `🧪 <b>Test OddsRadar</b>\nBot configurato correttamente. Riceverai qui i segnali automatici.`,
  );
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
}
