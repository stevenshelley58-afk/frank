import { describe, expect, it } from 'vitest';
import {
  CENTRAL,
  PROJECT_ROOMS,
  sortRoomsForDeck,
  waitingCount,
  type Room,
  type RoomStatus,
} from './rooms';

const NOW = 1_754_200_000_000;

function withStatus(id: string, status: RoomStatus, since: number, extra: Partial<Room> = {}): Room {
  const base = [CENTRAL, ...PROJECT_ROOMS].find((r) => r.id === id)!;
  return { ...base, status, statusSince: since, ...extra };
}

const ROOMS: Room[] = [
  withStatus('central', 'none', 0),
  withStatus('blockwise', 'waiting', NOW - 60_000, { snippet: '9 creatives need your tag.' }),
  withStatus('chase', 'running', NOW - 30_000),
  withStatus('merrypaws', 'verified', NOW - 90_000),
  withStatus('lotfile', 'none', 0),
];

describe('sortRoomsForDeck', () => {
  it('orders waiting → running → verified → none and excludes the current room', () => {
    const ordered = sortRoomsForDeck(ROOMS, 'central');
    expect(ordered.map((r) => r.id)).toEqual(['blockwise', 'chase', 'merrypaws', 'lotfile']);
  });

  it('Central is not pinned — it sorts by its own status', () => {
    const rooms = ROOMS.map((r) =>
      r.id === 'central' ? { ...r, status: 'waiting' as RoomStatus, statusSince: NOW - 5_000 } : r,
    );
    const ordered = sortRoomsForDeck(rooms, 'lotfile');
    // central is now waiting + freshest → leads the deck
    expect(ordered[0].id).toBe('central');
  });

  it('excludes whichever room the user is viewing', () => {
    const ordered = sortRoomsForDeck(ROOMS, 'chase');
    expect(ordered.map((r) => r.id)).toEqual(['blockwise', 'merrypaws', 'central', 'lotfile']);
  });

  it('breaks ties by most recent activity', () => {
    const two = [
      withStatus('blockwise', 'verified', NOW - 5_000),
      withStatus('merrypaws', 'verified', NOW - 1_000),
    ];
    const ordered = sortRoomsForDeck([...two, ROOMS[0]], 'central');
    expect(ordered.slice(0, 2).map((r) => r.id)).toEqual(['merrypaws', 'blockwise']);
  });

  it('reorders when a status changes', () => {
    const moved = ROOMS.map((r) =>
      r.id === 'merrypaws' ? { ...r, status: 'waiting' as RoomStatus, statusSince: NOW - 10_000 } : r,
    );
    const ordered = sortRoomsForDeck(moved, 'central');
    // merrypaws now waiting + fresher than blockwise → jumps ahead
    expect(ordered.map((r) => r.id)).toEqual(['merrypaws', 'blockwise', 'chase', 'lotfile']);
  });
});

describe('waitingCount', () => {
  it('counts waiting rooms excluding the current one', () => {
    expect(waitingCount(ROOMS, 'central')).toBe(1);
    expect(waitingCount(ROOMS, 'blockwise')).toBe(0);
  });
});
