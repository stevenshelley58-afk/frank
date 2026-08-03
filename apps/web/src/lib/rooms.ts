/**
 * Rooms — the identity layer of Frank OS (D7/D8).
 * Central is home: full Frank, ink composer. Project rooms are scoped
 * orchestrators, each with a visible muted tint so you always know where
 * you are. Tints are quiet by design — the shell stays neutral.
 */

export interface RoomChip {
  label: string;
  accent?: boolean;
}

/** Room lifecycle status for the ROOMS chip strip + peek card. */
export type RoomStatus = 'waiting' | 'running' | 'verified' | 'none';

export interface Room {
  id: string;
  name: string;
  /** the room's identity color — the ONLY saturated element it owns */
  tint: string;
  /** rgb triplet for alpha composites, e.g. "63,125,92" */
  rgb: string;
  agent: string;
  initials: string;
  /** sidebar subtitle */
  sub: string;
  /** room header subtitle */
  headerSub: string;
  placeholder: string;
  greeting: string;
  chips: RoomChip[];
  isHome?: boolean;
  /** static living-frame subtitle (kept for frame.tsx) */
  pulse?: string;
  /** live lifecycle status — merged from /api/room-status at render time */
  status?: RoomStatus;
  /** epoch ms when `status` last changed */
  statusSince?: number;
  /** ≤140-char plain-text tail of the latest reply (peek card snippet) */
  snippet?: string;
}

export const CENTRAL: Room = {
  id: 'central',
  name: 'Central',
  tint: '#1c1917',
  rgb: '28,25,23',
  agent: 'Frank',
  initials: 'F',
  sub: 'full Frank · manages everything',
  headerSub: 'full Frank — reads & writes everywhere · manages the org',
  placeholder: 'Tell Frank anything — he manages the whole org from here…',
  greeting:
    "Morning, Steve. The night shift finished clean — 7 runs verified, nothing on fire. I've got your brief in the frame on the right. Want the short version, or shall I just keep watching?",
  chips: [
    { label: 'Home', accent: true },
    { label: 'Global write' },
  ],
  isHome: true,
};

export const PROJECT_ROOMS: Room[] = [
  {
    id: 'blockwise',
    name: 'Blockwise',
    tint: '#4169c7',
    rgb: '65,105,199',
    agent: 'blockwise-frank',
    initials: 'BW',
    sub: 'blockwise-frank · Meta ad scraping',
    headerSub: 'blockwise-frank — reads everywhere, writes only here + shared with approval',
    placeholder: 'Write inside Blockwise — chip and ring say blue, no mistaking it…',
    greeting:
      "The Meta scraper pulled 214 Perth listings overnight; I verified the set. 9 creatives need your tag before the campaign fires — they're queued in Central's Waiting-on-you panel.",
    chips: [{ label: 'Project write' }, { label: 'Global read' }],
    pulse: '9 tags pending',
  },
  {
    id: 'chase',
    name: "Chase's Game",
    tint: '#7651a8',
    rgb: '118,81,168',
    agent: 'chase-frank',
    initials: 'CH',
    sub: 'chase-frank · selfie → character',
    headerSub: 'chase-frank — a life project, same anatomy as the work rooms',
    placeholder: "Write inside Chase's Game — chip and ring say purple…",
    greeting:
      "The selfie → character prototype is idle. Say the word and I'll spin up a stylizer pass — every write stays inside this room.",
    chips: [{ label: 'Project write' }, { label: 'Global read' }],
    pulse: 'prototype idle',
  },
  {
    id: 'merrypaws',
    name: 'MerryPaws',
    tint: '#a84f6c',
    rgb: '168,79,108',
    agent: 'merrypaws-frank',
    initials: 'MP',
    sub: 'merrypaws-frank · pet business ops',
    headerSub: 'merrypaws-frank — reads everywhere, writes only here + shared with approval',
    placeholder: 'Write inside MerryPaws — chip and ring say rose, no mistaking it…',
    greeting:
      "MerryPaws is quiet — no pending tasks. Drop something here and I'll keep it scoped to this room.",
    chips: [{ label: 'Project write' }, { label: 'Global read' }],
    pulse: 'idle',
  },
  {
    id: 'lotfile',
    name: 'LotFile',
    tint: '#c8692f',
    rgb: '200,105,47',
    agent: 'lotfile-frank',
    initials: 'LF',
    sub: 'lotfile-frank · document & lot ops',
    headerSub: 'lotfile-frank — reads everywhere, writes only here + shared with approval',
    placeholder: 'Write inside LotFile — chip and ring say copper, no mistaking it…',
    greeting:
      "LotFile is standing by. Drop a task and I'll scope every write to this room.",
    chips: [{ label: 'Project write' }, { label: 'Global read' }],
    pulse: 'idle',
  },
];

/** Tints handed to rooms founded ad-hoc in the UI. */
const SPARE_TINTS: Array<{ tint: string; rgb: string }> = [
  { tint: '#a04b58', rgb: '160,75,88' },
  { tint: '#6d5c96', rgb: '109,92,150' },
];

export const DEFAULT_ROOMS: Room[] = [CENTRAL, ...PROJECT_ROOMS];

export function roomById(rooms: Room[], id: string): Room {
  return rooms.find((r) => r.id === id) ?? CENTRAL;
}

/* ------------------------------------------------------------------ */
/* Room deck ordering — pure, unit-tested                              */
/* ------------------------------------------------------------------ */

/** waiting > running > verified > none — the mockup's priority order. */
const STATUS_RANK: Record<RoomStatus, number> = {
  waiting: 3,
  running: 2,
  verified: 1,
  none: 0,
};

/**
 * Rooms for the LATEST FROM OTHER ROOMS deck: every room except the one
 * being viewed, ordered waiting → running → verified → none, ties broken
 * by most recent activity (`statusSince` desc, room order as fallback).
 * No pinning — Central sorts by its own status like every other room.
 */
export function sortRoomsForDeck(rooms: Room[], currentId: string): Room[] {
  return rooms
    .filter((r) => r.id !== currentId)
    .slice()
    .sort((a, b) => {
      const rank = STATUS_RANK[b.status ?? 'none'] - STATUS_RANK[a.status ?? 'none'];
      if (rank !== 0) return rank;
      const ta = a.statusSince ?? 0;
      const tb = b.statusSince ?? 0;
      if (tb !== ta) return tb - ta;
      return rooms.indexOf(a) - rooms.indexOf(b);
    });
}

/** Count of rooms needing action — drives the deck's red counter. */
export function waitingCount(rooms: Room[], currentId: string): number {
  return rooms.filter(
    (r) => !r.isHome && r.id !== currentId && r.status === 'waiting',
  ).length;
}

/** Found a quick room client-side (the full founding ritual comes later). */
export function foundRoom(name: string, index: number): Room {
  const clean = name.trim();
  const slug =
    clean
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'room';
  const spare = SPARE_TINTS[index % SPARE_TINTS.length];
  const agent = `${slug}-frank`;
  return {
    id: `${slug}-${Date.now().toString(36)}`,
    name: clean || 'New room',
    tint: spare.tint,
    rgb: spare.rgb,
    agent,
    initials: clean.slice(0, 2).toUpperCase() || 'NR',
    sub: `${agent} · unfounded room`,
    headerSub: `${agent} — reads everywhere, writes only here + shared with approval`,
    placeholder: `Write inside ${clean || 'this room'} — chip and ring carry the tint so you know where you are…`,
    greeting:
      "Quick setup done — I'm unfounded for now, so my scope is simple: read everywhere, write only here. Run the full founding any time and I'll be born decided.",
    chips: [{ label: 'Project write' }, { label: 'Global read' }],
    pulse: 'just founded',
  };
}
