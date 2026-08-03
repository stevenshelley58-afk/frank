'use client';

/**
 * The LATEST FROM OTHER ROOMS deck — the mockup's real preview pane.
 *
 * A horizontal row of cards, one per room except the one being viewed.
 * Card anatomy (mockup): header = color chip · bold name · right-aligned
 * relative time; body = 2-line clamped snippet of what's happening;
 * footer = status pill (left) + status-appropriate action (right).
 * Waiting rooms carry the amber attention border and a solid Review
 * button; running rooms get a ghost Peek; everything else a ghost Open.
 *
 * The row scrolls horizontally with a hidden scrollbar; the page itself
 * never scrolls. Status is never color-only: every indicator sits next
 * to the room's name and carries a text pill.
 */

import type { Room } from '@/lib/rooms';
import { relTime } from '@/lib/time';

interface RoomDeckProps {
  rooms: Room[];
  onSelect: (id: string) => void;
}

export function RoomDeck({ rooms, onSelect }: RoomDeckProps) {
  return (
    <div
      className="deck-row flex gap-3 overflow-x-auto px-5 pb-3 pt-1 md:px-7"
      role="list"
      aria-label="Latest from other rooms"
    >
      {rooms.map((room) => (
        <DeckCard key={room.id} room={room} onSelect={onSelect} />
      ))}
    </div>
  );
}

function DeckCard({ room, onSelect }: { room: Room; onSelect: (id: string) => void }) {
  const status = room.status ?? 'none';
  const sinceIso = room.statusSince ? new Date(room.statusSince).toISOString() : null;

  return (
    <div
      role="listitem"
      className={`deck-card flex w-[216px] shrink-0 flex-col rounded-[10px] border bg-card p-3 ${
        status === 'waiting' ? 'deck-needs-action' : ''
      }`}
    >
      {/* header: chip · name · time */}
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ background: room.isHome ? 'var(--color-accent)' : room.tint }}
          aria-hidden
        />
        <b className="truncate text-[12.5px] font-semibold text-ink">{room.name}</b>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-subtle">
          {relTime(sinceIso)}
        </span>
      </div>

      {/* body — 2-line clamp of what's happening */}
      <p className="mb-2 line-clamp-2 min-h-[2.6em] text-[11.5px] leading-[1.35] text-muted">
        {room.snippet ?? quietLine(room)}
      </p>

      {/* footer: status pill · action */}
      <div className="mt-auto flex items-center gap-2">
        <StatusPill status={status} />
        <button
          onClick={() => onSelect(room.id)}
          className={`ml-auto rounded-[7px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            status === 'waiting'
              ? 'deck-review text-shell'
              : 'border border-line bg-transparent text-ink2 hover:bg-hover'
          }`}
          aria-label={`${actionLabel(status)} ${room.name}`}
        >
          {actionLabel(status)}
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: NonNullable<Room['status']> }) {
  const cfg = PILL[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${cfg.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      {cfg.label}
    </span>
  );
}

const PILL: Record<
  NonNullable<Room['status']>,
  { label: string; cls: string; dot: string }
> = {
  waiting: {
    label: 'Waiting',
    cls: 'bg-warning/10 text-warning',
    dot: 'bg-warning',
  },
  running: {
    label: 'Running',
    cls: 'bg-running/10 text-running',
    dot: 'bg-running',
  },
  verified: {
    label: 'Verified',
    cls: 'bg-acid/10 text-acid',
    dot: 'bg-acid',
  },
  none: {
    label: 'Quiet',
    cls: 'bg-hover text-muted',
    dot: 'bg-muted',
  },
};

function actionLabel(status: NonNullable<Room['status']>): string {
  switch (status) {
    case 'waiting':
      return 'Review';
    case 'running':
      return 'Peek';
    case 'verified':
      return 'Open';
    default:
      return 'Open';
  }
}

/** No live snippet yet — fall back to the room's static pulse line. */
function quietLine(room: Room): string {
  if (room.isHome) return 'Standing by — the org is quiet.';
  return room.pulse ? `${room.name} is ${room.pulse}.` : 'Quiet — nothing in flight.';
}
