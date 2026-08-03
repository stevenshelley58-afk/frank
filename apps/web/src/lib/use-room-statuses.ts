'use client';

/**
 * useRoomStatuses — merge the server's room-status ledger with the client's
 * live delegation activity into a single per-room status map.
 *
 * Two sources:
 *   1. Server — GET /api/room-status reflects turns streamed through the
 *      chat bridge (the durable half; survives page reloads).
 *   2. Client — delegations the store is running in the background (they
 *      never hit /api/chat as the current user turn, so the server can't
 *      see them). An active delegation ⇒ running; an errored one ⇒ waiting.
 *
 * Client delegation status wins on conflict so the room you delegated to a
 * second ago reads live even if the server ledger is a beat behind.
 */

import { useEffect, useState } from 'react';
import type { Room, RoomStatus } from '@/lib/rooms';
import { listDelegations, onDelegation } from '@/lib/delegation';

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
  const [clientBump, setClientBump] = useState(0);

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

  // Re-render when a delegation starts/finishes so background rooms go live.
  useEffect(() => {
    const off = onDelegation(() => setClientBump((n) => n + 1));
    return off;
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

  // Layer client delegation activity on top.
  void clientBump;
  for (const d of listDelegations()) {
    if (!roomIds.has(d.toRoomId)) continue;
    const cur = out[d.toRoomId];
    const delegationStatus: RoomStatus = d.status === 'running' ? 'running' : d.status === 'error' ? 'waiting' : 'verified';
    if (d.status === 'running' || cur.status === 'none') {
      out[d.toRoomId] = {
        status: delegationStatus,
        since: d.startedAt,
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
