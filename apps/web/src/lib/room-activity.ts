/**
 * Server-side per-room activity ledger — the live source of truth for the
 * ROOMS chip strip and peek card.
 *
 * Rooms are a web-app concept; the domain API has no room model. The only
 * place the server knows something is happening in a room is the chat
 * bridge (/api/chat), which streams harness turns per room. That route
 * reports turn start/end here; /api/room-status reads the ledger and
 * derives a status for every room.
 *
 * Module-level state lives for the lifetime of the Next.js server process —
 * the same lifetime as the chat route's session cache, so the two never
 * diverge across restarts.
 */

export type RoomStatus = 'running' | 'waiting' | 'verified' | 'none';

export interface RoomActivityEntry {
  /** turns currently streaming in this room (>0 ⇒ running) */
  activeTurns: number;
  /** epoch ms of the most recent finished turn (null if never) */
  lastEndedAt: number | null;
  /** the error of the most recent finished turn, null when it finished clean */
  lastError: string | null;
  /** ≤140-char plain-text tail of the most recent reply (the peek snippet) */
  lastSnippet: string | null;
}

const activity = new Map<string, RoomActivityEntry>();

/** A finished turn older than this no longer counts as verified/waiting. */
export const VERIFIED_WINDOW_MS = 24 * 60 * 60 * 1000;

function entryFor(roomId: string): RoomActivityEntry {
  let e = activity.get(roomId);
  if (!e) {
    e = { activeTurns: 0, lastEndedAt: null, lastError: null, lastSnippet: null };
    activity.set(roomId, e);
  }
  return e;
}

/** Called by the chat bridge when a harness turn starts streaming. */
export function startRoomTurn(roomId: string): void {
  entryFor(roomId).activeTurns += 1;
}

/** Called by the chat bridge when a turn ends (clean or error). */
export function endRoomTurn(
  roomId: string,
  opts: { error?: string | null; snippet?: string | null } = {},
  now: number = Date.now(),
): void {
  const e = entryFor(roomId);
  e.activeTurns = Math.max(0, e.activeTurns - 1);
  e.lastEndedAt = now;
  e.lastError = opts.error ?? null;
  if (opts.snippet) e.lastSnippet = clipSnippet(opts.snippet);
}

/** Trim a reply to the peek-card budget: ≤140 chars, single line, tail kept. */
export function clipSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 140) return flat;
  return '…' + flat.slice(-139).trimStart();
}

/** Derive the display status from raw activity. */
export function deriveRoomStatus(
  e: RoomActivityEntry | null,
  now: number = Date.now(),
): RoomStatus {
  if (!e) return 'none';
  if (e.activeTurns > 0) return 'running';
  if (e.lastEndedAt === null || now - e.lastEndedAt > VERIFIED_WINDOW_MS) return 'none';
  return e.lastError !== null ? 'waiting' : 'verified';
}

/** Read-only snapshot: roomId → derived status + raw counters. */
export function snapshotRoomStatus(
  now: number = Date.now(),
): Record<string, RoomActivityEntry & { status: RoomStatus }> {
  const out: Record<string, RoomActivityEntry & { status: RoomStatus }> = {};
  for (const [roomId, e] of activity) {
    out[roomId] = { ...e, status: deriveRoomStatus(e, now) };
  }
  return out;
}

/** Test hook — clears the ledger. Not used by request paths. */
export function resetRoomActivity(): void {
  activity.clear();
}
