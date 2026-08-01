'use client';

import { useState } from 'react';
import { foundRoom, type Room } from '@/lib/rooms';
import { IconPlus, IconShield, IconStar } from './icons';
import { useToast } from './providers';

interface RailProps {
  rooms: Room[];
  activeId: string;
  /** slide-over visibility on mobile */
  open: boolean;
  onSelect: (roomId: string) => void;
  onAddRoom: (room: Room) => void;
  onClose: () => void;
}

/**
 * Room switcher rail (D1/D7). Central is HOME — pinned, starred, set apart.
 * Project rooms follow; identity lives in the small muted tint dots.
 */
export function Rail({ rooms, activeId, open, onSelect, onAddRoom, onClose }: RailProps) {
  const { push } = useToast();
  const [foundingIndex, setFoundingIndex] = useState(0);
  const home = rooms.find((r) => r.isHome) ?? rooms[0];
  const projects = rooms.filter((r) => !r.isHome);

  const addRoom = () => {
    const name = window.prompt(
      'Name the new room — Frank will run the full founding ritual later; for now it opens unfounded.',
    );
    if (!name || !name.trim()) {
      push('info', 'Room founding cancelled.');
      return;
    }
    const room = foundRoom(name, foundingIndex);
    setFoundingIndex((n) => n + 1);
    onAddRoom(room);
    push('success', `${room.name} founded — quick setup, run full founding any time.`);
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col overflow-y-auto border-r border-line bg-rail px-3 py-4 transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* brand */}
        <div className="flex items-center gap-2.5 px-2 pb-5 pt-1">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-ink font-display text-[15px] font-bold text-white">
            F
          </span>
          <span className="font-display text-[13px] font-bold tracking-[0.16em] text-ink">
            FRANK
          </span>
        </div>

        <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/70">
          Rooms
        </div>

        {/* central — home, set apart */}
        {home && (
          <button
            onClick={() => onSelect(home.id)}
            className={`mb-2.5 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left transition-all duration-200 ${
              activeId === home.id
                ? 'border border-accent/40 bg-accent/[0.06]'
                : 'border border-line bg-white hover:border-accent/30 hover:bg-accent/[0.04]'
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-ink/15"
              style={{ background: '#1c1917' }}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight text-ink">
                {home.name}
              </span>
              <span className="block truncate text-[10px] leading-tight text-muted/70">
                {home.sub}
              </span>
            </span>
            <IconStar size={13} className="shrink-0 text-accent" />
          </button>
        )}

        {/* project rooms */}
        <div className="flex flex-col gap-0.5">
          {projects.map((r) => {
            const active = activeId === r.id;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all duration-200 ${
                  active ? 'bg-hover text-ink' : 'text-ink2 hover:bg-hover'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-ink/10"
                  style={{ background: r.tint }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight">
                    {r.name}
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-muted/70">
                    {r.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* new room */}
        <button
          onClick={addRoom}
          className="mt-2 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-muted transition-colors hover:bg-hover hover:text-ink2"
        >
          <span className="grid h-2.5 w-2.5 shrink-0 place-items-center">
            <IconPlus size={12} />
          </span>
          <span className="text-[12.5px] font-medium">New room</span>
        </button>

        {/* footer */}
        <div className="mt-auto pt-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-subtle px-3 py-2.5">
            <IconShield size={16} className="shrink-0 text-success" />
            <span>
              <b className="block text-[11px] font-semibold text-ink2">Private by design</b>
              <small className="block text-[10px] text-muted/70">Self-hosted on your VPS</small>
            </span>
          </div>
          <button
            onClick={() => push('info', 'Owner controls land in a later session.')}
            className="mt-2.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-hover"
          >
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
              SF
            </span>
            <span>
              <b className="block text-[12px] font-semibold text-ink">Steve</b>
              <small className="block text-[10px] text-muted/70">Owner · full autonomy</small>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
