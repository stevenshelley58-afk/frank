/**
 * /api/memory — the memory-control surface (BRAIN-006, FRANK-§4.6).
 *
 * Personal preference memories must be reviewable, editable, expirable, and
 * deletable. There is exactly ONE path to that data — the MemoryProvider port
 * — and these handlers call it directly. No admin back-door, no other route.
 *
 *   GET    /api/memory?roomId=&projectId=        list facts in a scope
 *   POST   /api/memory   { roomId, projectId, messages }  store (backend extracts)
 *   PATCH  /api/memory   { id, fact }            edit a fact's text
 *   PATCH  /api/memory   { id, expiresAt }       set an expiry
 *   DELETE /api/memory?id=                       permanently remove a fact
 *
 * Acceptance (BRAIN-006): "Memory control screen and end-to-end deletion
 * test." This file is the API half; the screen consumes it; the deletion test
 * drives store → list → delete → list-empty.
 */

import { NextRequest } from 'next/server';
import { getMemory } from '@/lib/memory-server';
import { memoryScope } from '@/lib/memory-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ScopeParams = { roomId?: string; projectId?: string };

function scopeFrom(req: NextRequest): { scope: ReturnType<typeof memoryScope>; params: ScopeParams } {
  const url = new URL(req.url);
  const roomId = url.searchParams.get('roomId') ?? undefined;
  const projectId = url.searchParams.get('projectId') ?? undefined;
  const params: ScopeParams = { roomId, projectId };
  return { scope: memoryScope(params), params };
}

export async function GET(req: NextRequest) {
  const { scope } = scopeFrom(req);
  try {
    const memory = getMemory();
    const facts = await memory.list(scope);
    const health = await memory.health();
    return Response.json({ backend: memory.name, healthy: health.healthy, scope, facts });
  } catch (err) {
    return Response.json({ error: `memory list failed: ${String(err)}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const typed = body as {
    roomId?: string;
    projectId?: string;
    messages?: ReadonlyArray<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  } | null;

  if (!typed || !Array.isArray(typed.messages) || typed.messages.length === 0) {
    return Response.json({ error: 'messages[] required' }, { status: 400 });
  }
  const scope = memoryScope({ roomId: typed.roomId, projectId: typed.projectId });

  try {
    const result = await getMemory().store({ messages: typed.messages, scope });
    return Response.json({ ok: true, scope, ...result });
  } catch (err) {
    return Response.json({ error: `memory store failed: ${String(err)}` }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const typed = body as { id?: string; fact?: string; expiresAt?: string } | null;

  if (!typed || !typed.id) {
    return Response.json({ error: 'id required' }, { status: 400 });
  }
  if (typed.fact === undefined && typed.expiresAt === undefined) {
    return Response.json({ error: 'fact or expiresAt required' }, { status: 400 });
  }

  try {
    const memory = getMemory();
    let fact;
    if (typed.fact !== undefined) {
      fact = await memory.edit({ id: typed.id, fact: typed.fact });
    }
    if (typed.expiresAt !== undefined) {
      fact = await memory.expire({ id: typed.id, expiresAt: typed.expiresAt });
    }
    return Response.json({ ok: true, fact });
  } catch (err) {
    return Response.json({ error: `memory update failed: ${String(err)}` }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id required' }, { status: 400 });
  }
  try {
    await getMemory().remove(id);
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json({ error: `memory delete failed: ${String(err)}` }, { status: 502 });
  }
}
