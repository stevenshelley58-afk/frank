'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_ROOMS, roomById, type Room } from '@/lib/rooms';
import { Rail } from '@/components/rail';
import { RoomView } from '@/components/room-view';
import { FrameColumn } from '@/components/frame';
import { IconFrame } from '@/components/icons';

/**
 * FRANK OS — chat-first shell.
 * Three columns: room-switcher rail · dominant chat · living frame.
 */
export default function Home() {
  const [rooms, setRooms] = useState<Room[]>(DEFAULT_ROOMS);
  const [activeId, setActiveId] = useState('central');
  const [frameOpen, setFrameOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  const room = roomById(rooms, activeId);

  // Escape closes the slide-over panels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFrameOpen(false);
        setRailOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* room switcher rail */}
      <Rail
        rooms={rooms}
        activeId={activeId}
        open={railOpen}
        onSelect={(id) => {
          setActiveId(id);
          setRailOpen(false);
        }}
        onAddRoom={(r) => {
          setRooms((prev) => [...prev, r]);
          setActiveId(r.id);
          setRailOpen(false);
        }}
        onClose={() => setRailOpen(false)}
      />

      {/* dominant chat column */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-3 lg:hidden">
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Open rooms"
            className="grid h-8 w-8 place-items-center rounded-lg bg-ink font-display text-[15px] font-bold text-white"
          >
            F
          </button>
          <span className="font-display text-[13px] font-semibold tracking-wide text-ink">
            {room.name}
          </span>
          <span
            className="h-2.5 w-2.5 rounded-[3px] ring-1 ring-ink/10"
            style={{ background: room.tint }}
            aria-hidden
          />
          <button
            onClick={() => setFrameOpen(true)}
            aria-label="Open living frame"
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            <IconFrame size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <RoomView key={room.id} room={room} />
        </div>
      </main>

      {/* living frame — fixed column ≥lg, slide-over below */}
      <aside className="hidden w-[340px] shrink-0 border-l border-line bg-shell lg:block xl:w-[352px]">
        <FrameColumn room={room} />
      </aside>

      {/* mobile slide-over: living frame */}
      {frameOpen && <Backdrop onClick={() => setFrameOpen(false)} />}
      <div
        className={`fixed inset-y-0 right-0 z-40 w-[88vw] max-w-[360px] border-l border-line bg-shell transition-transform duration-300 lg:hidden ${
          frameOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted/80">
              Living frame
            </span>
            <button
              onClick={() => setFrameOpen(false)}
              aria-label="Close living frame"
              className="px-1 text-muted transition-colors hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <FrameColumn room={room} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Backdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-[2px] lg:hidden"
      onClick={onClick}
      aria-hidden
    />
  );
}
