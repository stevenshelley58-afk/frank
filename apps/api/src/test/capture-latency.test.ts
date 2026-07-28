/**
 * UX-004 — "Capture must acknowledge durability in under 500 ms at the API
 * boundary, even when downstream enrichment is delayed."
 *
 * Acceptance evidence in the specification: "Load test and **queue interruption
 * test**." This file is the queue interruption test, and the interruption is
 * total: the enrichment handler returns a promise that is never resolved and
 * never rejected. Not a slow handler — a stopped one.
 *
 * ## What is measured, and why that is the right thing
 *
 * The stopwatch starts immediately before `app.inject()` and stops immediately
 * after it resolves. That interval contains routing, authentication,
 * authorization, schema validation, the FRANK-§6.9 policy evaluation, the
 * durable write, response schema validation, and serialization — the whole of
 * what the server controls. It excludes the network, which the requirement
 * cannot be about, since no server can promise a latency across a link it does
 * not own.
 *
 * ## Why a database is not required for *this* file
 *
 * The claim being tested is structural: that the acknowledgement does not wait
 * for enrichment. A store whose cost is *known* makes that provable — see the
 * "budget accounting" test, which gives the transaction a deliberate 200 ms and
 * asserts the response arrives within a small margin of it rather than within
 * 200 ms plus however long enrichment takes (which, here, is forever).
 *
 * The real numbers against real PostgreSQL are in
 * `capture-latency.integration.test.ts`, which self-skips without
 * `FRANK_TEST_DATABASE_URL`. Both are needed: a fake store is always fast, and a
 * fast real measurement does not prove the decoupling on its own.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { InProcessEnrichmentDispatcher } from '../services/enrichment.js';
import type { EnrichmentJob } from '../services/enrichment.js';
import { FakeDomainStore } from './fake-store.js';
import { buildTestServer, commandId } from './harness.js';
import type { TestServer } from './harness.js';

/** UX-004's number. */
const UX_004_BUDGET_MS = 500;

let server: TestServer | undefined;

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
});

/**
 * A handler that never settles.
 *
 * `new Promise(() => {})` and nothing else: no timer to fire, no rejection to
 * catch. If the request path awaited it, every test in this file would time out
 * rather than fail — which is a usefully unambiguous failure mode.
 */
function stalledHandler(): {
  handler: () => Promise<void>;
  received: EnrichmentJob[];
} {
  const received: EnrichmentJob[] = [];
  return {
    handler: async () => {
      await new Promise<void>(() => {
        /* deliberately never settles */
      });
    },
    received,
  };
}

async function captureOnce(
  target: TestServer,
  text = 'Remember to renew the passport before the trip.',
): Promise<{ status: number; body: Record<string, unknown>; elapsedMs: number }> {
  const started = process.hrtime.bigint();
  const response = await target.app.inject({
    method: 'POST',
    url: '/v1/capture',
    headers: { authorization: target.auth(['owner']), 'content-type': 'application/json' },
    payload: { command_id: commandId(), kind: 'text', text },
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    status: response.statusCode,
    body: response.json() as Record<string, unknown>,
    elapsedMs,
  };
}

describe('UX-004 — capture acknowledges durability under 500 ms with enrichment stalled', () => {
  it('acknowledges while the enrichment handler is permanently blocked', async () => {
    const { handler } = stalledHandler();
    const enrichment = new InProcessEnrichmentDispatcher({ handler, concurrency: 1 });
    server = buildTestServer({ store: new FakeDomainStore(), enrichment });

    const result = await captureOnce(server);

    expect(result.status).toBe(201);
    expect(result.body['acknowledgement']).toBe('durable');
    expect(result.body['source_id']).toEqual(expect.any(String));
    expect(result.body['work_item_id']).toEqual(expect.any(String));
    // ADR-004: the outbox rows committed with the domain change.
    expect(result.body['emitted_event_ids']).toHaveLength(2);
    expect(result.elapsedMs).toBeLessThan(UX_004_BUDGET_MS);

    // eslint-disable-next-line no-console -- this number is the deliverable.
    console.log(
      `UX-004 [stalled enrichment, in-memory store]: ${result.elapsedMs.toFixed(2)} ms (budget ${String(UX_004_BUDGET_MS)} ms)`,
    );
  });

  it('stays inside the budget across 50 consecutive captures with enrichment stalled', async () => {
    const { handler } = stalledHandler();
    // Concurrency 1 and capacity 8 so the queue saturates almost immediately and
    // the dispatcher starts shedding — the worst case for the request path.
    const enrichment = new InProcessEnrichmentDispatcher({
      handler,
      concurrency: 1,
      capacity: 8,
    });
    server = buildTestServer({ store: new FakeDomainStore(), enrichment });

    const timings: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      const result = await captureOnce(server, `Capture number ${String(index)}`);
      expect(result.status).toBe(201);
      timings.push(result.elapsedMs);
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;

    // eslint-disable-next-line no-console -- this number is the deliverable.
    console.log(
      `UX-004 [50 captures, stalled+saturated enrichment, in-memory store]: ` +
        `p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms (budget ${String(UX_004_BUDGET_MS)} ms)`,
    );

    expect(max).toBeLessThan(UX_004_BUDGET_MS);

    // The dispatcher shed load rather than growing without bound, and it says so.
    const status = enrichment.status(new Date());
    expect(status.dropped).toBeGreaterThan(0);
    expect(status.queueDepth).toBeLessThanOrEqual(8);
  });

  /**
   * The decoupling test proper.
   *
   * The store is given a deliberate 200 ms cost. If enrichment were on the
   * request path the response could not arrive before "forever". If it is off
   * the path, the response arrives at roughly the store's cost.
   *
   * The margin is 150 ms rather than something tight, because this test must not
   * become a flaky measurement of continuous-integration machine load. It is
   * still an extremely strong assertion: the alternative outcome is not "260 ms",
   * it is "the test times out".
   */
  it('costs the transaction plus overhead, not the transaction plus enrichment', async () => {
    const { handler } = stalledHandler();
    const enrichment = new InProcessEnrichmentDispatcher({ handler, concurrency: 1 });
    const store = new FakeDomainStore({ captureDelayMs: 200 });
    server = buildTestServer({ store, enrichment });

    const result = await captureOnce(server);

    expect(result.status).toBe(201);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(190);
    expect(result.elapsedMs).toBeLessThan(200 + 150);
    expect(result.elapsedMs).toBeLessThan(UX_004_BUDGET_MS);

    // eslint-disable-next-line no-console -- this number is the deliverable.
    console.log(
      `UX-004 [200 ms simulated transaction, stalled enrichment]: ${result.elapsedMs.toFixed(2)} ms`,
    );
  });

  it('reports the enrichment state in the acknowledgement rather than hiding it', async () => {
    const { handler } = stalledHandler();
    const enrichment = new InProcessEnrichmentDispatcher({ handler, concurrency: 1, capacity: 2 });
    server = buildTestServer({ store: new FakeDomainStore(), enrichment });

    const first = await captureOnce(server, 'first');
    // UX-007's principle: the response says where enrichment stands. It never
    // claims enrichment finished.
    expect(['deferred', 'queued', 'unavailable']).toContain(
      (first.body['enrichment'] as { state: string }).state,
    );

    for (let index = 0; index < 6; index += 1) {
      await captureOnce(server, `filler ${String(index)}`);
    }

    const saturated = await captureOnce(server, 'after saturation');
    const enrichmentBlock = saturated.body['enrichment'] as { state: string; detail: string };
    expect(enrichmentBlock.state).toBe('unavailable');
    expect(enrichmentBlock.detail).toMatch(/durable/);
  });

  it('never awaits the dispatcher: submit() returns void, so a route cannot', () => {
    const { handler } = stalledHandler();
    const enrichment = new InProcessEnrichmentDispatcher({ handler });
    const returned: unknown = enrichment.submit({
      kind: 'source.captured',
      cellId: 'cell-steven',
      sourceId: 'src-1',
      workItemId: 'wi-1',
      correlationId: 'corr-1',
      submittedAt: new Date(),
    });
    // A `Promise` here would mean a route could `await` it and reintroduce the
    // coupling UX-004 forbids. The signature is the control.
    expect(returned).toBeUndefined();
  });

  it('a replay is also inside the budget and submits no second enrichment job', async () => {
    const { handler } = stalledHandler();
    const enrichment = new InProcessEnrichmentDispatcher({ handler, concurrency: 1 });
    server = buildTestServer({ store: new FakeDomainStore(), enrichment });

    const key = commandId('replay');
    const payload = { command_id: key, kind: 'text', text: 'the same words twice' };
    const headers = {
      authorization: server.auth(['owner']),
      'content-type': 'application/json',
    };

    const first = await server.app.inject({
      method: 'POST',
      url: '/v1/capture',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const depthAfterFirst = enrichment.status(new Date()).queueDepth;

    const started = process.hrtime.bigint();
    const second = await server.app.inject({
      method: 'POST',
      url: '/v1/capture',
      headers,
      payload,
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    expect(second.statusCode).toBe(201);
    const body = second.json() as Record<string, unknown>;
    expect(body['replayed']).toBe(true);
    expect(body['replay_reason']).toBe('request');
    // A replay emits no events: the capture already happened.
    expect(body['emitted_event_ids']).toEqual([]);
    expect(elapsedMs).toBeLessThan(UX_004_BUDGET_MS);

    // And it did not queue a second enrichment job for work already queued.
    expect(enrichment.status(new Date()).queueDepth).toBe(depthAfterFirst);

    // eslint-disable-next-line no-console -- this number is the deliverable.
    console.log(`UX-004 [replay, stalled enrichment]: ${elapsedMs.toFixed(2)} ms`);
  });
});
