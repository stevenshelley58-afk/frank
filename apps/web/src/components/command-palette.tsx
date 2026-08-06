'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { DEFAULT_ROOMS } from '@/lib/rooms';
import { consoleModules } from '@/app/console/registry';

/* ------------------------------------------------------------------ */
/* ⌘K command palette (Track A3).                                       */
/*                                                                      */
/* Rooms are state-based on `/` (no URL per room), consoles are URL     */
/* routes. The palette therefore needs a bridge: the home page          */
/* registers its room selector via useCommandPalette().registerRooms(); */
/* elsewhere, selecting a room deep-links to /?room=<id>, which Home    */
/* reads on mount.                                                      */
/* ------------------------------------------------------------------ */

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  registerRooms: (select: (roomId: string) => void) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  setOpen: () => {},
  registerRooms: () => {},
});

export const useCommandPalette = () => useContext(CommandPaletteContext);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const roomSelectRef = useRef<((roomId: string) => void) | null>(null);
  const router = useRouter();

  const registerRooms = useCallback((select: (roomId: string) => void) => {
    roomSelectRef.current = select;
  }, []);

  /* Global hotkey: Cmd/Ctrl+K from anywhere. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectRoom = useCallback(
    (roomId: string) => {
      setOpen(false);
      if (roomSelectRef.current) {
        roomSelectRef.current(roomId);
      } else {
        router.push(`/?room=${roomId}`);
      }
    },
    [router],
  );

  const rooms = useMemo(() => DEFAULT_ROOMS, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, registerRooms }}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        /* Mobile (A3): bottom-sheet presentation — the dialog docks to the
         * bottom edge on small screens instead of floating mid-viewport. */
        className="max-w-lg data-[state=open]:max-sm:translate-y-[38vh] data-[state=open]:max-sm:w-full data-[state=open]:max-sm:max-w-none data-[state=open]:max-sm:rounded-b-none data-[state=open]:max-sm:border-b-0"
      >
        <CommandInput placeholder="Jump to a room or console…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          <CommandGroup heading="Rooms">
            {rooms.map((room) => (
              <CommandItem
                key={room.id}
                /* name + sub + agent all feed the fuzzy match */
                value={`${room.name} ${room.sub} ${room.agent}`}
                onSelect={() => selectRoom(room.id)}
              >
                <span
                  className="mr-2 size-2 shrink-0 rounded-full"
                  style={{ background: room.tint }}
                  aria-hidden
                />
                <span className="flex-1">{room.name}</span>
                <span className="text-[10px] font-mono uppercase text-muted">{room.sub}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Consoles">
            {consoleModules.map((module) => (
              <CommandItem
                key={module.id}
                value={`${module.title} ${module.description} ${module.system}`}
                onSelect={() => {
                  setOpen(false);
                  router.push(`/console/${module.id}`);
                }}
              >
                <span className="flex-1">{module.title}</span>
                <CommandShortcut>{module.system}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}
