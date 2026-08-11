/**
 * GET /api/providers — harness registry status + routes.
 * POST /api/providers — hot-swap a room's harness. Body: { roomId, providerId }
 *
 * The interface explains the actual selection in plain language (spec §8.4).
 */

import { NextRequest } from 'next/server';
import {
  providerStatuses,
  getRoomRoute,
  setRoomRoute,
  getProvider,
} from '@/lib/providers';
import { DEFAULT_ROOMS } from '@/lib/rooms';
import { isSameOriginMutation } from '@/lib/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = await providerStatuses();
  return Response.json({
    providers,
    routes: Object.fromEntries(DEFAULT_ROOMS.map((room) => [room.id, getRoomRoute(room.id)])),
  });
}

export async function POST(req: NextRequest) {
  if (!isSameOriginMutation(req)) {
    return Response.json(
      { error: 'Harness route changes must be same-origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const body = await req.json().catch(() => null);
  const roomId = (body as { roomId?: string })?.roomId;
  const providerId = (body as { providerId?: string })?.providerId;

  if (!roomId || !providerId) {
    return Response.json({ error: 'roomId and providerId required' }, { status: 400 });
  }
  if (!DEFAULT_ROOMS.some((room) => room.id === roomId)) {
    return Response.json({ error: `unknown room: ${roomId}` }, { status: 400 });
  }
  if (providerId !== 'auto' && !getProvider(providerId)) {
    return Response.json({ error: `unknown provider: ${providerId}` }, { status: 400 });
  }
  if (providerId !== 'auto') {
    const provider = getProvider(providerId)!;
    if (!(await provider.health().catch(() => false))) {
      return Response.json({ error: `${provider.label} is unavailable` }, { status: 503 });
    }
  }

  setRoomRoute(roomId, providerId);
  const resolved = providerId === 'auto' ? 'auto (broker picks)' : getProvider(providerId)?.label;
  return Response.json(
    { ok: true, roomId, providerId, resolved, persistence: 'process-local' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
