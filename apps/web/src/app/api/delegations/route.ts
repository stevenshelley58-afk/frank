import { NextRequest } from 'next/server';
import { create, subscribe, type DelegationEvent } from '@/lib/delegation-store';
import { DEFAULT_ROOMS } from '@/lib/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — SSE stream: a snapshot immediately, then every event. */
export async function GET() {
  const encoder = new TextEncoder();
  let off: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: DelegationEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      off = subscribe(send);
    },
    cancel() {
      off?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/** POST — create a delegation. Called by the delegate MCP tool. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const roomKey = String((body as { room?: string })?.room ?? '').toLowerCase();
  const task = String((body as { task?: string })?.task ?? '').trim();
  const why = String((body as { why?: string })?.why ?? '').trim();
  const key = String((body as { key?: string })?.key ?? '').trim();
  const confidenceRaw = String((body as { confidence?: string })?.confidence ?? 'unsure');
  const confidence = confidenceRaw === 'sure' ? 'sure' : 'unsure';

  if (!task || task.length < 12) {
    return json({ error: 'task must be a concrete instruction of at least 12 characters' }, 400);
  }
  if (!key) {
    return json({ error: 'key (idempotency key) is required' }, 400);
  }

  const room = DEFAULT_ROOMS.find(
    (r) => !r.isHome && (r.id === roomKey || r.agent.toLowerCase() === roomKey),
  );
  if (!room) {
    const valid = DEFAULT_ROOMS.filter((r) => !r.isHome).map((r) => r.id).join(', ');
    return json({ error: `unknown room "${roomKey}". Valid rooms: ${valid}` }, 400);
  }

  const d = create({
    key,
    task,
    why,
    toRoomId: room.id,
    toRoomName: room.name,
    agent: room.agent,
    confidence,
  });

  return json({ id: d.id, status: d.status, room: room.id }, 200);
}

function json(v: unknown, status: number) {
  return new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
