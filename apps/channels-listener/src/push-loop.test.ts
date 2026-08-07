/**
 * CH-07 — push-loop unit tests: delivery retry, outage isolation, ack.
 *
 * Proves the §3.5 outage-isolation posture: when the Domain API is
 * unreachable the loop reports truthfully and does NOT advance the cursor or
 * touch canonical state. Delivered events are acked; failed events stay for
 * retry.
 */

import { describe, expect, it, vi } from 'vitest';

import { runPushCycle } from './push-loop.js';
import type { OutboxEvent } from './frank-api.js';

function event(id: string, sequence: number): OutboxEvent {
  return {
    id,
    sequence,
    type: 'frank.workbench.state_changed.v1',
    source: `frank://workbench/${id}`,
    subject: `workbench/${id}`,
    aggregate_kind: 'workbench',
    aggregate_id: id,
    data: { toState: 'running' },
    created_at: '2026-08-07T00:00:00Z',
  };
}

function fakeFrankApi(opts: {
  unreachable?: boolean;
  ok?: boolean;
  events?: OutboxEvent[];
}) {
  return {
    pollOutbox: vi.fn(async () => ({
      status: opts.unreachable ? 0 : opts.ok === false ? 500 : 200,
      ok: !(opts.unreachable || opts.ok === false),
      body: null,
      unreachable: opts.unreachable ?? false,
      events: opts.events ?? [],
    })),
    ackOutbox: vi.fn(async () => ({ status: 200, ok: true, body: null, unreachable: false })),
  };
}

describe('runPushCycle (CH-07)', () => {
  it('outage isolation: unreachable API -> truthful report, cursor unchanged', async () => {
    const frankApi = fakeFrankApi({ unreachable: true });
    const pushEvent = vi.fn(async () => true);

    const outcome = await runPushCycle(10, {
      frankApi,
      pushEvent,
      types: ['frank.workbench.state_changed.v1'],
    });

    expect(outcome.apiUnreachable).toBe(true);
    expect(outcome.cursor).toBe(10); // unchanged — retry from the same point
    expect(pushEvent).not.toHaveBeenCalled(); // nothing pushed during outage
    expect(outcome.pushed).toBe(0);
  });

  it('delivered events are acked and the cursor advances', async () => {
    const events = [event('wb1', 11), event('wb2', 12)];
    const frankApi = fakeFrankApi({ events });
    const pushEvent = vi.fn(async () => true);

    const outcome = await runPushCycle(10, {
      frankApi,
      pushEvent,
      types: ['frank.workbench.state_changed.v1'],
    });

    expect(outcome.apiUnreachable).toBe(false);
    expect(outcome.pushed).toBe(2);
    expect(outcome.cursor).toBe(12);
    expect(frankApi.ackOutbox).toHaveBeenCalledTimes(1);
    const [ids] = (frankApi.ackOutbox as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ids).toEqual(['wb1', 'wb2']);
  });

  it('a failed push stays for retry (no ack) and reports the failure', async () => {
    const events = [event('wb1', 11), event('wb2', 12)];
    const frankApi = fakeFrankApi({ events });
    const markFailure = vi.fn(async () => {});
    // wb1 fails to deliver; wb2 succeeds.
    const pushEvent = vi.fn(async (e: OutboxEvent) => e.id !== 'wb1');

    const outcome = await runPushCycle(10, {
      frankApi,
      pushEvent,
      markFailure,
      types: ['frank.workbench.state_changed.v1'],
    });

    expect(outcome.pushed).toBe(1);
    expect(outcome.failed).toBe(1);
    // Only the delivered event is acked; the failed one stays pending.
    expect(frankApi.ackOutbox).toHaveBeenCalledTimes(1);
    const [ids] = (frankApi.ackOutbox as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ids).toEqual(['wb2']);
    // The failure was recorded server-side for retry accounting.
    expect(markFailure).toHaveBeenCalledWith(['wb1'], 'delivery failed');
  });

  it('a poll error (non-unreachable) stops the cycle without advancing', async () => {
    const frankApi = fakeFrankApi({ ok: false });
    const pushEvent = vi.fn(async () => true);

    const outcome = await runPushCycle(5, {
      frankApi,
      pushEvent,
      types: ['frank.workbench.state_changed.v1'],
    });

    expect(outcome.apiUnreachable).toBe(false);
    expect(outcome.cursor).toBe(5);
    expect(pushEvent).not.toHaveBeenCalled();
  });
});
