'use client';

/**
 * The ROOMS chip strip — Atlantic light rendering of the mockup's deck row.
 *
 * Central is pinned far left (signal-tinted face, 1px divider after it);
 * everything else follows by status: waiting → running → verified → none,
 * most-recent first. The row scrolls horizontally with a hidden scrollbar;
 * the page itself never scrolls.
 *
 * Status is never color-only: every indicator sits next to the room's name.
 * Verified/waiting rooms carry a breathing ring; running rooms a pulsing
 * corner dot. All motion dies under prefers-reduced-motion (globals.css).
 */

import type { Room } from '@/lib/rooms';

interface ChipStripProps {
  rooms: Room[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ChipStrip({ rooms, activeId, onSelect }: ChipStripProps) {
  return (
    <div
      className="chip-row flex shrink-0 gap-2.5 overflow-x-auto px-5 pb-2 pt-1 md:px-7"
      role="tablist"
      aria-label="Rooms"
    >
      {rooms.map((room) => (
        <Chip key={room.id} room={room} active={room.id === activeId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function Chip({ room, active, onSelect }: { room: Room; active: boolean; onSelect: (id: string) => void }) {
  const status = room.status ?? 'none';
  const isCentral = room.isHome;

  return (
    <button
      role="tab"
      aria-selected={active}
      aria-label={`${room.name}${statusLabel(status)}`}
      onClick={() => onSelect(room.id)}
      className="chip flex min-w-16 shrink-0 cursor-pointer flex-col items-center gap-1.5 border-none bg-transparent p-0"
      style={{ position: 'relative' }}
    >
      <span
        className="face relative grid h-12 w-12 place-items-center rounded-[14px] border bg-card text-[15px] font-bold transition-transform duration-150 hover:scale-[1.04]"
        style={{
          color: isCentral ? 'var(--color-accent)' : room.tint,
          borderColor: isCentral ? 'rgba(242,59,29,0.45)' : 'var(--color-border)',
        }}
      >
        {room.initials}
        {status === 'waiting' && <span className="ring-indicator waiting" aria-hidden />}
        {status === 'verified' && <span className="ring-indicator verified" aria-hidden />}
        {status === 'running' && <span className="corner-dot" aria-hidden />}
      </span>
      <span className="whitespace-nowrap text-[10.5px] text-muted">{room.name}</span>
      {isCentral && <span className="central-divider" aria-hidden />}
    </button>
  );
}

function statusLabel(status: Room['status']): string {
  switch (status) {
    case 'waiting':
      return ', needs review';
    case 'running':
      return ', running';
    case 'verified':
      return ', verified';
    default:
      return '';
  }
}
