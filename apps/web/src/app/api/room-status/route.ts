/**
 * GET /api/room-status — live lifecycle status for the ROOMS chip strip.
 *
 * Rooms are a web-app concept; the server's only real signal is the chat
 * bridge's per-room turn activity (src/lib/room-activity.ts). This route
 * publishes that ledger so the client can merge it over the room model:
 *
 *   running  — a harness turn is streaming in the room right now
 *   waiting  — the last turn errored (needs a look) within 24h
 *   verified — the last turn finished clean within 24h
 *   none     — quiet / stale
 *
 * Client delegation activity (background rooms the store is running) is
 * tracked client-side and merged in useRoomStatuses; this endpoint is the
 * durable server half.
 */

import { NextResponse } from 'next/server';
import { snapshotRoomStatus, type RoomStatus } from '@/lib/room-activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface RoomStatusPayload {
  /** ISO instant the snapshot was taken */
  generatedAt: string;
  rooms: Record<
    string,
    {
      status: RoomStatus;
      /** epoch ms the status last changed (last turn end; turn start for running) */
      since: number | null;
      /** ≤140-char plain-text tail of the latest reply, for the peek card */
      snippet: string | null;
    }
  >;
}

export function GET() {
  const now = Date.now();
  const snap = snapshotRoomStatus(now);

  const rooms: RoomStatusPayload['rooms'] = {};
  for (const [roomId, e] of Object.entries(snap)) {
    rooms[roomId] = {
      status: e.status,
      since: e.activeTurns > 0 ? now : e.lastEndedAt,
      snippet: e.lastSnippet,
    };
  }

  return NextResponse.json({ generatedAt: new Date(now).toISOString(), rooms });
}
