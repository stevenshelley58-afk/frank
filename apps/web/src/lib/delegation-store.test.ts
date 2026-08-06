import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  approve,
  reject,
  get,
  subscribe,
  type DelegationEvent,
} from './delegation-store';

// Mock the harness runner so tests never touch a real session cache.
vi.mock('./harness-session', () => ({
  runTurn: vi.fn().mockResolvedValue({ text: 'done', meta: { harness: 'goose', reason: 'test', modelInfo: { provider: null, model: null } } }),
}));

import { runTurn } from './harness-session';

/** Wait for the fire-and-forget run() promise chain to settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Collect events for one test; returns { events, stop }. */
function collect(): { events: DelegationEvent[]; stop: () => void } {
  const events: DelegationEvent[] = [];
  const stop = subscribe((e) => events.push(e));
  return { events, stop };
}

let keyCounter = 0;
function uniqueKey(): string {
  keyCounter += 1;
  return `test-key-${Date.now()}-${keyCounter}`;
}

const BASE = {
  task: 'Write a one-paragraph spec for the selfie stylizer art direction',
  why: 'test',
  toRoomId: 'chase',
  toRoomName: "Chase's Game",
  agent: 'chase-frank',
};

afterEach(() => {
  vi.mocked(runTurn).mockClear();
});

describe('delegation-store idempotency', () => {
  it('create() with the same key twice returns the same id and emits exactly one created event', () => {
    const { events, stop } = collect();
    const key = uniqueKey();
    const first = create({ ...BASE, key, confidence: 'unsure' });
    const second = create({ ...BASE, key, confidence: 'unsure' });
    stop();
    expect(second.id).toBe(first.id);
    expect(events.filter((e) => e.type === 'created')).toHaveLength(1);
  });
});

describe('delegation-store confidence gating', () => {
  it("confidence 'unsure' yields proposed and does not invoke the runner", () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    expect(d.status).toBe('proposed');
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("approve() on a proposed delegation moves it to running and runs exactly once", async () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    approve(d.id);
    await flush();
    const after = get(d.id)!;
    expect(after.startedAt).not.toBeNull();
    expect(runTurn).toHaveBeenCalledTimes(1);
    // The run completes against the mocked runner.
    expect(after.status).toBe('done');
  });

  it('approve() called twice only runs once', async () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    approve(d.id);
    approve(d.id);
    await flush();
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it('reject() sets rejected and never runs', async () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    const after = reject(d.id)!;
    await flush();
    expect(after.status).toBe('rejected');
    expect(get(d.id)!.status).toBe('rejected');
    expect(runTurn).not.toHaveBeenCalled();
  });
});

describe('delegation-store failure path', () => {
  it('a runner throw sets status error and populates error', async () => {
    vi.mocked(runTurn).mockRejectedValueOnce(new Error('harness exploded'));
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'sure' });
    await flush();
    const after = get(d.id)!;
    expect(after.status).toBe('error');
    expect(after.error).toContain('harness exploded');
    expect(after.finishedAt).not.toBeNull();
  });
});
