import { beforeEach, describe, expect, it } from 'vitest';
import {
  clipSnippet,
  deriveRoomStatus,
  endRoomTurn,
  resetRoomActivity,
  snapshotRoomStatus,
  startRoomTurn,
  VERIFIED_WINDOW_MS,
} from './room-activity';

const NOW = 1_754_200_000_000;

describe('deriveRoomStatus', () => {
  it('is none when there is no activity', () => {
    expect(deriveRoomStatus(null, NOW)).toBe('none');
  });

  it('running beats everything while a turn is streaming', () => {
    expect(
      deriveRoomStatus({ activeTurns: 2, lastEndedAt: NOW - 10, lastError: 'x', lastSnippet: null }, NOW),
    ).toBe('running');
  });

  it('errored finished turn ⇒ waiting inside the window', () => {
    expect(
      deriveRoomStatus({ activeTurns: 0, lastEndedAt: NOW - 1000, lastError: 'boom', lastSnippet: null }, NOW),
    ).toBe('waiting');
  });

  it('clean finished turn ⇒ verified inside the window', () => {
    expect(
      deriveRoomStatus({ activeTurns: 0, lastEndedAt: NOW - 1000, lastError: null, lastSnippet: null }, NOW),
    ).toBe('verified');
  });

  it('decays to none after the verified window', () => {
    expect(
      deriveRoomStatus(
        { activeTurns: 0, lastEndedAt: NOW - VERIFIED_WINDOW_MS - 1, lastError: null, lastSnippet: null },
        NOW,
      ),
    ).toBe('none');
  });
});

describe('clipSnippet', () => {
  it('flattens whitespace', () => {
    expect(clipSnippet('  line one\n\n  line two  ')).toBe('line one line two');
  });

  it('clips long replies to 140 chars keeping the tail', () => {
    const long = 'a'.repeat(200) + 'TAIL';
    const clipped = clipSnippet(long);
    expect(clipped.length).toBe(140);
    expect(clipped.startsWith('…')).toBe(true);
    expect(clipped.endsWith('TAIL')).toBe(true);
  });
});

describe('ledger lifecycle', () => {
  beforeEach(() => resetRoomActivity());

  it('tracks start → end with snippet and derives verified', () => {
    startRoomTurn('central');
    expect(snapshotRoomStatus(NOW).central.status).toBe('running');

    endRoomTurn('central', { snippet: 'done, verified clean' }, NOW);
    const snap = snapshotRoomStatus(NOW).central;
    expect(snap.status).toBe('verified');
    expect(snap.lastSnippet).toBe('done, verified clean');
    expect(snap.activeTurns).toBe(0);
  });

  it('an errored turn surfaces as waiting', () => {
    startRoomTurn('blockwise');
    endRoomTurn('blockwise', { error: 'harness timeout' }, NOW);
    expect(snapshotRoomStatus(NOW).blockwise.status).toBe('waiting');
  });

  it('never lets activeTurns go negative on stray ends', () => {
    endRoomTurn('chase', {}, NOW);
    expect(snapshotRoomStatus(NOW).chase.activeTurns).toBe(0);
  });

  it('concurrent turns stay running until the last ends', () => {
    startRoomTurn('central');
    startRoomTurn('central');
    endRoomTurn('central', {}, NOW);
    expect(snapshotRoomStatus(NOW).central.status).toBe('running');
    endRoomTurn('central', {}, NOW);
    expect(snapshotRoomStatus(NOW).central.status).toBe('verified');
  });
});
