'use client';

/**
 * useRoomStatuses — merge the server's room-status ledger with live
 * delegation activity into a single per-room status map.
 *
 * Two sources:
 *   1. Server — GET /api/room-status reflects turns streamed through the
 *      chat bridge (the durable half; survives page reloads).
 *   2. Delegations — streamed live from /api/delegations (server-owned;
 *      they run on the server so the client hook tracks them). An active
 *      delegation ⇒ running; an errored one ⇒ waiting.
 *
 * Delegation status wins on conflict so the room you delegated to a
 * second ago reads live even if the server ledger is a beat behind.
 */

import { useEffect, useState } from 'react';
import type { Room, RoomStatus } from '@/lib/rooms';
import { useDelegations } from '@/lib/use-delegations';

interface ServerRoomStatus {
  status: RoomStatus;
  since: number | null;
  snippet: string | null;
}

interface ServerPayload {
  generatedAt: string;
  rooms: Record<string, ServerRoomStatus>;
}

export interface RoomStatusInfo {
  status: RoomStatus;
  since: number | null;
  snippet: string | null;
}

/** Poll cadence — fast enough to feel live, cheap enough to forget. */
const POLL_MS = 5000;

export function useRoomStatuses(rooms: Room[]): Record<string, RoomStatusInfo> {
  const [server, setServer] = useState<Record<string, ServerRoomStatus>>({});
  const delegations = useDelegations();

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const res = await fetch('/api/room-status', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = (await res.json()) as ServerPayload;
        if (alive) setServer(payload.rooms ?? {});
      } catch {
        // transient — keep the last good snapshot
      }
    }

    void load();
    timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const roomIds = new Set(rooms.map((r) => r.id));
  const out: Record<string, RoomStatusInfo> = {};

  for (const id of roomIds) {
    out[id] = {
      status: server[id]?.status ?? 'none',
      since: server[id]?.since ?? null,
      snippet: server[id]?.snippet ?? null,
    };
  }

  // Layer live delegation activity on top.
  for (const d of delegations) {
    if (!roomIds.has(d.toRoomId)) continue;
    if (d.status !== 'running' && d.status !== 'done' && d.status !== 'error') continue;
    const cur = out[d.toRoomId];
    const delegationStatus: RoomStatus = d.status === 'running' ? 'running' : d.status === 'error' ? 'waiting' : 'verified';
    if (d.status === 'running' || cur.status === 'none') {
      out[d.toRoomId] = {
        status: delegationStatus,
        since: d.startedAt ?? cur.since,
        snippet: cur.snippet ?? (d.status !== 'running' ? (d.result ?? d.error ?? null) : null),
      };
    }
  }

  return out;
}

/** Rooms with live status merged in — ready for chips / peek ordering. */
export function withStatus(rooms: Room[], statuses: Record<string, RoomStatusInfo>): Room[] {
  return rooms.map((r) => {
    const s = statuses[r.id];
    if (!s || s.status === 'none') return r;
    return {
      ...r,
      status: s.status,
      statusSince: s.since ?? r.statusSince,
      snippet: s.snippet ?? r.snippet,
    };
  });
}
