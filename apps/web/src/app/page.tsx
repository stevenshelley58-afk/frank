'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DEFAULT_ROOMS, roomById, type Room } from '@/lib/rooms';
import { useRoomStatuses, withStatus } from '@/lib/use-room-statuses';
import { Rail } from '@/components/rail';
import { RoomView } from '@/components/room-view';
import { FrameColumn } from '@/components/frame';
import { PreviewZone } from '@/components/room/preview-zone';
import { WorktreesSheet, WorktreesChip } from '@/components/worktree-panel';
import { IconFrame } from '@/components/icons';
import { useToast } from '@/components/providers';
import { useCommandPalette } from '@/components/command-palette';

/**
 * FRANK OS — chat-first shell (FRANK Atlantic Design System 1.1).
 *
 * Desktop (≥lg): room-switcher rail · quiet Atlantic workspace · living
 * frame. Mobile (<lg): single chat surface,
 * room header up top, living frame in a sheet, and a mono bottom dock
 * (Home / Rooms / Running / You) — rail hidden.
 */
export default function Home() {
  return (
    <Suspense fallback={<div className="h-dvh bg-shell" aria-label="Loading Frank" />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const requestedRoom = searchParams.get('room') ?? undefined;
  const { push } = useToast();
  const [baseRooms, setBaseRooms] = useState<Room[]>(DEFAULT_ROOMS);
  const [activeId, setActiveId] = useState(
    () => (requestedRoom && DEFAULT_ROOMS.some((r) => r.id === requestedRoom)
      ? requestedRoom
      : 'central'),
  );
  const [frameOpen, setFrameOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [wtOpen, setWtOpen] = useState(false);

  /* Track A3: register this page's room selector with the ⌘K palette, and
   * pick up ?room= deep-links (palette selections made from other routes). */
  const { registerRooms } = useCommandPalette();
  useEffect(() => {
    registerRooms((roomId: string) => setActiveId(roomId));
  }, [registerRooms]);
  useEffect(() => {
    if (requestedRoom && DEFAULT_ROOMS.some((r) => r.id === requestedRoom)) {
      setActiveId(requestedRoom);
    }
  }, [requestedRoom]);

  // Preview zone: expanded by default; the small square toggles it.
  const [expanded, setExpanded] = useState(true);

  // Live room statuses: server ledger + client delegations merged.
  const statuses = useRoomStatuses(baseRooms);
  const rooms = withStatus(baseRooms, statuses);

  const room = roomById(rooms, activeId);
  const home = rooms.find((r) => r.isHome) ?? rooms[0];

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
    <div className="flex h-dvh overflow-hidden bg-shell">
      {/* room switcher rail — persistent on desktop, slide-over on mobile */}
      <Rail
        rooms={rooms}
        activeId={activeId}
        open={railOpen}
        onSelect={(id) => {
          setActiveId(id);
          setRailOpen(false);
        }}
        onAddRoom={(r) => {
          setBaseRooms((prev) => [...prev, r]);
          setActiveId(r.id);
          setRailOpen(false);
        }}
        onClose={() => setRailOpen(false)}
      />

      {/* the conversation workspace */}
      <main className="frank-workspace flex min-w-0 flex-1 flex-col bg-shell text-ink">
        {/* mobile room header — DS p-head: tint dot · name · mono scope · FRAME */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-rail px-4 lg:hidden">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-ink/15"
            style={{ background: room.isHome ? 'var(--color-accent)' : room.tint }}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold leading-tight text-ink">
              {room.name}
            </span>
            <span className="block truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              {room.agent} · {room.isHome ? 'full scope' : 'scoped'}
            </span>
          </span>
          <button
            onClick={() => setFrameOpen(true)}
            className="ml-auto shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted transition-colors hover:text-accent"
          >
            Frame
          </button>
          <WorktreesChip onClick={() => setWtOpen(true)} />
        </div>

        {/* preview zone — LATEST FROM OTHER ROOMS deck + minimize square */}
        <PreviewZone
          rooms={rooms}
          currentId={activeId}
          expanded={expanded}
          onSelectRoom={(id) => setActiveId(id)}
          onToggleExpanded={() => setExpanded((v) => !v)}
        />

        {/* spacer so the composer clears the mobile bottom dock */}
        <div className="min-h-0 flex-1 pb-16 lg:pb-0">
          <RoomView key={room.id} room={room} rooms={rooms} />
        </div>
      </main>

      {/* living frame — fixed column ≥lg, slide-over below */}
      <aside className="hidden w-[340px] shrink-0 border-l border-line bg-frame lg:block xl:w-[352px]">
        <FrameColumn room={room} />
      </aside>

      {/* mobile slide-over: living frame */}
      {frameOpen && <Backdrop onClick={() => setFrameOpen(false)} />}

      {/* mobile worktrees full-screen sheet */}
      <WorktreesSheet open={wtOpen} onClose={() => setWtOpen(false)} />
      <div
        className={`fixed inset-y-0 right-0 z-40 w-[88vw] max-w-[360px] border-l border-line bg-frame transition-transform duration-300 lg:hidden ${
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

      {/* mobile bottom dock — ink chrome: mono, four targets, active in signal */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t border-line bg-rail text-muted lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <DockTab
          label="Home"
          active={activeId === home.id}
          onClick={() => {
            setActiveId(home.id);
            setRailOpen(false);
          }}
        />
        <DockTab label="Rooms" active={railOpen} onClick={() => setRailOpen((v) => !v)} />
        <Link
          href="/console"
          className="grid place-items-center font-mono text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors hover:text-accent"
        >
          Running
        </Link>
        <DockTab
          label="You"
          active={false}
          onClick={() => push('info', 'Owner controls land in a later session.')}
        />
      </nav>
    </div>
  );
}

function DockTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`grid place-items-center font-mono text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors ${
        active ? 'text-accent' : 'hover:text-accent'
      }`}
    >
      {label}
    </button>
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
