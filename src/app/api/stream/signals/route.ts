import { auth } from '@/lib/auth/auth';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  const sql = postgres(DATABASE_URL, { max: 1 });

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      sendEvent('ready', { ts: Date.now() });

      const listener = await sql.listen('signal_created', (payload) => {
        try {
          sendEvent('signal', JSON.parse(payload));
        } catch {
          sendEvent('signal', { raw: payload });
        }
      });

      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      }, 25_000);

      const close = async () => {
        clearInterval(keepalive);
        await listener.unlisten().catch(() => undefined);
        await sql.end({ timeout: 5 }).catch(() => undefined);
      };

      controller.error = close as unknown as ReadableStreamDefaultController['error'];
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
