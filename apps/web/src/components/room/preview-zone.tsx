'use client';

/**
 * Preview zone — everything above the bottom-anchored chat:
 *   ROOMS label row (+ restore pill) · chip strip · peek card · grab handle.
 *
 * The grab handle collapses/expands the whole zone; when collapsed the chat
 * reclaims the space. Dismiss state for the peek lives in page.tsx so it
 * survives room switches.
 */

import {
  sortRoomsForChips,
  topPeekRoom,
  waitingCount,
  type Room,
} from '@/lib/rooms';
import { ChipStrip } from './chip-strip';
import { PeekCard } from './peek-card';

interface PreviewZoneProps {
  rooms: Room[];
  currentId: string;
  expanded: boolean;
  peekDismissed: boolean;
  onSelectRoom: (id: string) => void;
  onDismissPeek: () => void;
  onRestorePeek: () => void;
  onToggleExpanded: () => void;
}

export function PreviewZone({
  rooms,
  currentId,
  expanded,
  peekDismissed,
  onSelectRoom,
  onDismissPeek,
  onRestorePeek,
  onToggleExpanded,
}: PreviewZoneProps) {
  const chips = sortRoomsForChips(rooms, currentId);
  const peekRoom = topPeekRoom(rooms, currentId);
  const waiting = waitingCount(rooms, currentId);
  const showRestore = peekDismissed && (waiting > 0 || peekRoom !== null);

  return (
    <div className="shrink-0">
      {/* label row — ROOMS on the left, restore pill reserved on the right */}
      <div className="flex items-center px-5 pt-3 md:px-7">
        <span className="ds-label text-subtle">Rooms</span>
        {showRestore && (
          <button
            onClick={onRestorePeek}
            className="restore-pill ml-auto"
            aria-label={`Show preview — ${waiting} waiting`}
          >
            <span className="d" aria-hidden />
            {waiting > 0 ? `${waiting} waiting · show` : 'show'}
          </button>
        )}
      </div>

      {/* the collapsible zone */}
      <div
        className="grid transition-[grid-template-rows] duration-300"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <ChipStrip rooms={chips} activeId={currentId} onSelect={onSelectRoom} />
          {peekRoom && (
            <PeekCard
              room={peekRoom}
              dismissed={peekDismissed}
              onDismiss={onDismissPeek}
              onOpen={() => onSelectRoom(peekRoom.id)}
            />
          )}
        </div>
      </div>

      {/* grab handle — keyboard focusable, Enter/Space toggles */}
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
