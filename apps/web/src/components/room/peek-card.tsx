'use client';

/**
 * The dismissible peek card — Atlantic light rendering of the mockup's peek.
 *
 * Surfaces the single highest-priority room: tint dot · name · relative
 * time · ✕, a two-line snippet, and status-appropriate actions. Waiting
 * rooms get the amber "needs action" border and a solid Review button;
 * running rooms a ghost Peek; verified rooms a ghost Open.
 */

import type { Room } from '@/lib/rooms';
import { relTime } from '@/lib/time';

interface PeekCardProps {
  room: Room;
  dismissed: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}

export function PeekCard({ room, dismissed, onDismiss, onOpen }: PeekCardProps) {
  const status = room.status ?? 'none';
  const sinceIso = room.statusSince ? new Date(room.statusSince).toISOString() : null;

  return (
    <div className={`peek ${status === 'waiting' ? 'needs-action' : ''} ${dismissed ? 'dismissed' : ''} mx-5 mt-1.5 md:mx-7`}>
      {/* top row: dot · name · when · close */}
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: room.tint }}
          aria-hidden
        />
        <b className="text-[12.5px] font-semibold text-ink">{room.name}</b>
        <span className="ml-auto font-mono text-[10px] text-subtle">
          {statusLabel(status)} · {relTime(sinceIso)}
        </span>
        <button
          onClick={onDismiss}
          aria-label="Close preview"
          className="grid h-10 w-10 shrink-0 -my-2 -mr-2 place-items-center rounded-[7px] text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <span className="text-[14px] leading-none" aria-hidden>✕</span>
        </button>
      </div>

      {/* snippet — 2-line clamp */}
      {room.snippet && (
        <p className="mb-2 line-clamp-2 text-[12px] leading-[1.45] text-ink2">{room.snippet}</p>
      )}

      {/* actions by status */}
      <div className="flex gap-2">
        {status === 'waiting' ? (
          <>
            <button onClick={onOpen} className="peek-act flex-1 rounded-lg py-2 text-[12px] font-semibold text-white" style={{ background: 'rgb(var(--tw-warning))' }}>
              Review
            </button>
            <button onClick={onDismiss} className="peek-act flex-1 rounded-lg border border-line bg-transparent py-2 text-[12px] font-semibold text-ink2 transition-colors hover:bg-hover">
              Later
            </button>
          </>
        ) : status === 'running' ? (
          <button onClick={onOpen} className="peek-act flex-1 rounded-lg border border-line bg-transparent py-2 text-[12px] font-semibold text-ink2 transition-colors hover:bg-hover">
            Peek
          </button>
        ) : (
          <button onClick={onOpen} className="peek-act flex-1 rounded-lg border border-line bg-transparent py-2 text-[12px] font-semibold text-ink2 transition-colors hover:bg-hover">
            Open
          </button>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: Room['status']): string {
  switch (status) {
    case 'waiting':
      return 'needs review';
    case 'running':
      return 'running';
    case 'verified':
      return 'verified';
    default:
      return 'quiet';
  }
}
