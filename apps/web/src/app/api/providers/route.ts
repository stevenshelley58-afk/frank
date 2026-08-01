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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = await providerStatuses();
  return Response.json({
    providers,
    routes: {
      central: getRoomRoute('central'),
      blockwise: getRoomRoute('blockwise'),
      chase: getRoomRoute('chase'),
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const roomId = (body as { roomId?: string })?.roomId;
  const providerId = (body as { providerId?: string })?.providerId;

  if (!roomId || !providerId) {
    return Response.json({ error: 'roomId and providerId required' }, { status: 400 });
  }
  if (providerId !== 'auto' && !getProvider(providerId)) {
    return Response.json({ error: `unknown provider: ${providerId}` }, { status: 400 });
  }

  setRoomRoute(roomId, providerId);
  const resolved = providerId === 'auto' ? 'auto (broker picks)' : getProvider(providerId)?.label;
  return Response.json({ ok: true, roomId, providerId, resolved });
}
