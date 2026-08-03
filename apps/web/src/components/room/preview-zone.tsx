'use client';

/**
 * Preview zone — the LATEST FROM OTHER ROOMS pane above the chat.
 *
 * Mockup anatomy, top to bottom:
 *   label row   "LATEST FROM OTHER ROOMS" · red "N need attention" ·
 *               a small square that minimizes the whole pane
 *   deck        horizontal row of room cards (what's happening where)
 *   divider     "CHAT · DRAG TO EXPAND" — also toggles the pane
 *
 * When minimized the pane collapses to just the divider; the chat
 * reclaims the space. Expanded state lives in page.tsx.
 */

import { sortRoomsForDeck, waitingCount, type Room } from '@/lib/rooms';
import { RoomDeck } from './room-deck';

interface PreviewZoneProps {
  rooms: Room[];
  currentId: string;
  expanded: boolean;
  onSelectRoom: (id: string) => void;
  onToggleExpanded: () => void;
}

export function PreviewZone({
  rooms,
  currentId,
  expanded,
  onSelectRoom,
  onToggleExpanded,
}: PreviewZoneProps) {
  const deck = sortRoomsForDeck(rooms, currentId);
  const waiting = waitingCount(rooms, currentId);

  return (
    <div className="shrink-0">
      {/* label row */}
      <div className="flex items-center gap-3 px-5 pt-3 md:px-7">
        <span className="ds-label text-subtle">Latest from other rooms</span>
        {waiting > 0 && (
          <span
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-danger"
            aria-live="polite"
          >
            {waiting} need{waiting === 1 ? 's' : ''} attention
          </span>
        )}
        {/* the small square — explicit minimize control */}
        <button
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? 'Minimize room preview' : 'Show room preview'}
          className="deck-minimize ml-auto"
          title={expanded ? 'Minimize' : 'Expand'}
        >
          <span className="bar" aria-hidden />
        </button>
      </div>

      {/* the collapsible deck */}
      <div
        className="grid transition-[grid-template-rows] duration-300"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <RoomDeck rooms={deck} onSelect={onSelectRoom} />
        </div>
      </div>

      {/* divider — keyboard focusable, Enter/Space toggles */}
      <button
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse preview zone' : 'Expand preview zone'}
        className="grab-handle"
      >
        <span className="bar" aria-hidden />
        <span>{expanded ? 'Chat' : 'Chat · expand'}</span>
        <span className="bar" aria-hidden />
      </button>
    </div>
  );
}
