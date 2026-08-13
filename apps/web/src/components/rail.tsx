'use client';

import { useCallback, useEffect, useState } from 'react';
import { foundRoom, type Room } from '@/lib/rooms';
import { IconPlus, IconShield, IconStar } from './icons';
import { useToast } from './providers';
import { Sheet, SheetContent, SheetDescription } from './ui/sheet';
import { cn } from '@/lib/utils';

/* Track A6 — rail hardening. Patterns adapted from the shadcn sidebar block
 * (vendored as reference in tools/shadcn-vendor/registry/sidebar.json), not
 * a wholesale replacement — Frank's tint dots, home-pinning and room
 * identity (D7/D8/D10) are untouched:
 *
 *   - mobile drawer: the hand-rolled fixed overlay + backdrop div is now a
 *     Sheet (Radix Dialog) — focus trap, Escape-to-close, focus return and
 *     scroll lock come with the primitive
 *   - desktop collapse: collapses to an icon strip (sidebar block's
 *     collapsible="icon" pattern), persisted in a cookie for 7 days
 *   - keyboard: Cmd/Ctrl+B toggles collapse (sidebar block's shortcut),
 *     the rail itself is native buttons/links so tab order works
 */

const RAIL_COOKIE_NAME = 'frank_rail_collapsed';
const RAIL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

interface RailProps {
  rooms: Room[];
  activeId: string;
  /** slide-over visibility on mobile */
  open: boolean;
  onSelect: (roomId: string) => void;
  onAddRoom: (room: Room) => void;
  onClose: () => void;
}

/** True below the lg breakpoint where the rail goes static (sidebar block's
 *  useIsMobile pattern, adapted to Frank's 1024px rail breakpoint). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

/* ------------------------------------------------------------------ */
/* Rail content — rendered inside the desktop aside AND the mobile     */
/* sheet. `collapsed` only applies to the desktop strip.               */
/* ------------------------------------------------------------------ */

function RailContent({
  rooms,
  activeId,
  collapsed,
  onSelect,
  onAddRoom,
}: {
  rooms: Room[];
  activeId: string;
  collapsed: boolean;
  onSelect: (roomId: string) => void;
  onAddRoom: (room: Room) => void;
}) {
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
    <div className="flex h-full flex-col px-3 py-4">
      {/* brand — official FRANK lockup from the brand kit (ink on paper) */}
      <div className={cn('flex items-center px-2 pb-5 pt-1', collapsed && 'justify-center px-0')}>
        {!collapsed && (
          <img
            src="/brand/navbar-logo.png"
            alt="FRANK"
            draggable={false}
            className="h-7 w-auto select-none"
          />
        )}
      </div>

      {!collapsed && (
        <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/70">
          Home
        </div>
      )}

      {/* central — home, set apart */}
      {home && (
        <button
          onClick={() => onSelect(home.id)}
          aria-current={activeId === home.id ? 'page' : undefined}
          title={collapsed ? home.name : undefined}
          className={cn(
            'mb-2.5 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left transition-all duration-200',
            collapsed && 'justify-center px-0',
            activeId === home.id
              ? 'border border-accent/40 bg-accent/10'
              : 'border border-line bg-card hover:border-accent/30 hover:bg-accent/[0.05]',
          )}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-ink/15"
            style={{ background: '#F23B1D' }}
          />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold leading-tight text-ink">
                  {home.name}
                </span>
                <span className="block truncate text-[10px] leading-tight text-muted/70">
                  {home.sub}
                </span>
              </span>
              <IconStar size={13} className="shrink-0 text-accent" />
            </>
          )}
        </button>
      )}

      {!collapsed && (
        <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted/70">
          Rooms
        </div>
      )}

      {/* project rooms */}
      <div className="flex flex-col gap-0.5">
        {projects.map((r) => {
          const active = activeId === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? r.name : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all duration-200',
                collapsed && 'justify-center px-0',
                active ? 'bg-hover text-ink' : 'text-ink2 hover:bg-hover',
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-ink/10"
                style={{ background: r.tint }}
              />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight">
                    {r.name}
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-muted/70">
                    {r.sub}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* new room */}
      <button
        onClick={addRoom}
        title={collapsed ? 'New room' : undefined}
        className={cn(
          'mt-2 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-muted transition-colors hover:bg-hover hover:text-ink2',
          collapsed && 'justify-center px-0',
        )}
      >
        <span className="grid h-2.5 w-2.5 shrink-0 place-items-center">
          <IconPlus size={12} />
        </span>
        {!collapsed && <span className="text-[12.5px] font-medium">New room</span>}
      </button>

      {/* footer */}
      <div className="mt-auto pt-4">
        {!collapsed && (
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(21,23,17,0.04)]">
            <IconShield size={16} className="shrink-0 text-success" />
            <span>
              <b className="block text-[11px] font-semibold text-ink2">Private by design</b>
              <small className="block text-[10px] text-muted/70">Self-hosted on your VPS</small>
            </span>
          </div>
        )}
        <button
          onClick={() => push('info', 'Owner controls land in a later session.')}
          title={collapsed ? 'Steve — Owner' : undefined}
          className={cn(
            'mt-2.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-hover',
            collapsed && 'mt-1 justify-center px-0 py-2',
          )}
        >
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-white">
            SF
          </span>
          {!collapsed && (
            <span>
              <b className="block text-[12px] font-semibold text-ink">Steve</b>
              <small className="block text-[10px] text-muted/70">Owner · full autonomy</small>
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Room switcher rail (D1/D7). Central is HOME — pinned, starred, set apart.
 * Brand lock: the FRANK mark is the brand-kit logo asset, never a hand-drawn
 * letterbox (frank-brand-assets usage rules). Project rooms follow; identity
 * lives in the small muted tint dots.
 */
export function Rail({ rooms, activeId, open, onSelect, onAddRoom, onClose }: RailProps) {
  const isMobile = useIsMobile();

  /* Desktop collapse, persisted (sidebar block's cookie pattern). */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const stored = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${RAIL_COOKIE_NAME}=`));
    if (stored) setCollapsed(stored.split('=')[1] === '1');
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${RAIL_COOKIE_NAME}=${next ? '1' : '0'}; path=/; max-age=${RAIL_COOKIE_MAX_AGE}`;
      return next;
    });
  }, []);

  /* Keyboard: Cmd/Ctrl+B toggles the desktop rail (sidebar block shortcut).
     Only wired on desktop — on mobile the sheet owns Escape. */
  useEffect(() => {
    if (isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, toggleCollapsed]);

  return (
    <>
      {/* Desktop: static aside, collapsible to an icon strip. */}
      <aside
        aria-label="Room switcher"
        className={cn(
          'frank-navigation relative hidden h-full shrink-0 flex-col overflow-y-auto border-r border-line bg-rail transition-[width] duration-300 lg:flex',
          collapsed ? 'w-[64px]' : 'w-[248px]',
        )}
      >
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand room switcher' : 'Collapse room switcher'}
          className={cn(
            'absolute top-3 z-10 grid h-6 w-6 place-items-center rounded-md border border-line bg-card text-muted transition-colors hover:text-ink',
            collapsed ? 'left-1/2 -translate-x-1/2' : 'right-2',
          )}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={cn('transition-transform', collapsed && 'rotate-180')}
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <RailContent
          rooms={rooms}
          activeId={activeId}
          collapsed={collapsed}
          onSelect={onSelect}
          onAddRoom={onAddRoom}
        />
      </aside>

      {/* Mobile: Sheet drawer — focus trap, Escape, focus return, scroll lock. */}
      {isMobile && (
        <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
          <SheetContent
            side="left"
            aria-label="Room switcher"
            className="frank-navigation w-[248px] border-line bg-rail p-0"
          >
            <SheetDescription className="sr-only">
              Switch rooms, open consoles, and found new rooms.
            </SheetDescription>
            <RailContent
              rooms={rooms}
              activeId={activeId}
              collapsed={false}
              onSelect={(id) => {
                onSelect(id);
                onClose();
              }}
              onAddRoom={(room) => {
                onAddRoom(room);
                onClose();
              }}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
