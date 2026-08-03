import { describe, expect, it } from 'vitest';
import {
  CENTRAL,
  PROJECT_ROOMS,
  sortRoomsForChips,
  topPeekRoom,
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

describe('sortRoomsForChips', () => {
  it('pins Central first and orders waiting → running → verified → none', () => {
    const ordered = sortRoomsForChips(ROOMS, 'central');
    expect(ordered.map((r) => r.id)).toEqual(['central', 'blockwise', 'chase', 'merrypaws', 'lotfile']);
  });

  it('excludes the room the user is viewing', () => {
    const ordered = sortRoomsForChips(ROOMS, 'chase');
    expect(ordered.map((r) => r.id)).toEqual(['central', 'blockwise', 'merrypaws', 'lotfile']);
  });

  it('reorders when a status changes', () => {
    const moved = ROOMS.map((r) =>
      r.id === 'merrypaws' ? { ...r, status: 'waiting' as RoomStatus, statusSince: NOW - 10_000 } : r,
    );
    const ordered = sortRoomsForChips(moved, 'central');
    // merrypaws now waiting + fresher than blockwise → jumps ahead
    expect(ordered.map((r) => r.id)).toEqual(['central', 'merrypaws', 'blockwise', 'chase', 'lotfile']);
  });

  it('breaks ties by most recent activity', () => {
    const two = [
      withStatus('central', 'none', 0),
      withStatus('blockwise', 'verified', NOW - 5_000),
      withStatus('merrypaws', 'verified', NOW - 1_000),
    ];
    const ordered = sortRoomsForChips(two, 'central');
    expect(ordered.map((r) => r.id)).toEqual(['central', 'merrypaws', 'blockwise']);
  });

  it('works when viewing Central itself — Central stays pinned', () => {
    const ordered = sortRoomsForChips(ROOMS, 'central');
    expect(ordered[0].isHome).toBe(true);
    expect(ordered).toHaveLength(5);
  });

  it('Central stays pinned while a project room is current', () => {
    const ordered = sortRoomsForChips(ROOMS, 'chase');
    expect(ordered[0].id).toBe('central');
  });
});

describe('topPeekRoom', () => {
  it('picks the highest-priority room', () => {
    expect(topPeekRoom(ROOMS, 'central')?.id).toBe('blockwise');
  });

  it('never picks Central or the current room', () => {
    expect(topPeekRoom(ROOMS, 'blockwise')?.id).toBe('chase');
  });

  it('returns null when nothing is surfaced', () => {
    const quiet = ROOMS.map((r) => ({ ...r, status: 'none' as RoomStatus }));
    expect(topPeekRoom(quiet, 'central')).toBeNull();
  });

  it('breaks same-rank ties by freshness', () => {
    const two = [
      withStatus('central', 'none', 0),
      withStatus('blockwise', 'waiting', NOW - 60_000),
      withStatus('chase', 'waiting', NOW - 10_000),
    ];
    expect(topPeekRoom(two, 'central')?.id).toBe('chase');
  });
});

describe('waitingCount', () => {
  it('counts waiting rooms excluding the current one', () => {
    expect(waitingCount(ROOMS, 'central')).toBe(1);
    expect(waitingCount(ROOMS, 'blockwise')).toBe(0);
  });
});
