import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  create,
  approve,
  reject,
  get,
  subscribe,
  type DelegationEvent,
} from './delegation-store';

// WB-05: delegations execute through the FRANK Domain API's workbench front
// door, never in-process. Mock the client so tests never touch a network.
vi.mock('./domain-api', () => ({
  domainApiFetch: vi.fn().mockResolvedValue({
    status: 200,
    body: { workbench: { id: 'wb-test-1' }, created: true },
  }),
}));

import { domainApiFetch } from './domain-api';

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
  vi.mocked(domainApiFetch).mockClear();
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
  it("confidence 'unsure' yields proposed and does not invoke the domain API", () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    expect(d.status).toBe('proposed');
    expect(domainApiFetch).not.toHaveBeenCalled();
  });

  it('approve() on a proposed delegation moves it to running and submits exactly once', async () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    approve(d.id);
    await flush();
    const after = get(d.id)!;
    expect(after.startedAt).not.toBeNull();
    expect(domainApiFetch).toHaveBeenCalledTimes(1);
    // The delegation key is the idempotency key sent to the front door.
    const [path, init] = vi.mocked(domainApiFetch).mock.calls[0]!;
    expect(path).toBe('/v1/workbenches');
    expect((init.body as { command_id: string }).command_id).toBe(d.key);
    expect(after.status).toBe('done');
    expect(after.result).toContain('wb-test-1');
  });

  it('approve() called twice only submits once', async () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    approve(d.id);
    approve(d.id);
    await flush();
    expect(domainApiFetch).toHaveBeenCalledTimes(1);
  });

  it('reject() sets rejected and never submits', async () => {
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'unsure' });
    const after = reject(d.id)!;
    await flush();
    expect(after.status).toBe('rejected');
    expect(get(d.id)!.status).toBe('rejected');
    expect(domainApiFetch).not.toHaveBeenCalled();
  });
});

describe('delegation-store failure path', () => {
  it('an unreachable domain API sets status error honestly (no silent in-process run)', async () => {
    vi.mocked(domainApiFetch).mockResolvedValueOnce({ status: 503, body: null });
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'sure' });
    await flush();
    const after = get(d.id)!;
    expect(after.status).toBe('error');
    expect(after.error).toContain('NOT executed');
    expect(after.finishedAt).not.toBeNull();
  });

  it('a rejected submission records the HTTP status', async () => {
    vi.mocked(domainApiFetch).mockResolvedValueOnce({ status: 422, body: null });
    const d = create({ ...BASE, key: uniqueKey(), confidence: 'sure' });
    await flush();
    const after = get(d.id)!;
    expect(after.status).toBe('error');
    expect(after.error).toContain('422');
  });
});
