/**
 * HITL-01 + HITL-02 — the decision seam against real PostgreSQL.
 *
 * Verify gates (master plan §8F):
 *   HITL-01: "Decision is indistinguishable in the API from other ADR-022
 *            approvals" — a decision request creates a NORMAL decision work
 *            item in `waiting` and pauses the workbench.
 *   HITL-02: "Resume after ready; cancel -> safe-fail; duplicate/stale
 *            commands rejected via expected-version semantics" — resolution
 *            flows through the NORMAL command envelope on the decision item,
 *            never through a workbench-specific approval surface.
 *
 * Requires `FRANK_TEST_DATABASE_URL` (harness derives the sibling `_api` DB).
 * Self-skips with a visible reason when unset (repo convention).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresDomainStore } from '../services/postgres-store.js';
import { WorkbenchStore } from '../services/workbench/store.js';
import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';
import {
  SKIP_REASON,
  apiDatabaseUrl,
  ensureApiDatabase,
  openApiTestDatabase,
  resetApiDatabase,
  requiresDatabase,
} from './db-harness.js';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

const TASK_DEF = {
  instruction: 'Prepare the quarterly comparison sheet from the raw export.',
  harness: { adapter: 'goose' },
};

describe.skipIf(requiresDatabase)(`HITL decision seam against PostgreSQL (${SKIP_REASON})`, () => {
  let handle: FrankDatabaseHandle | undefined;
  let server: TestServer | undefined;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    server = buildTestServer({
      store: new PostgresDomainStore({
        connectionString: apiDatabaseUrl() as string,
        applicationName: 'frank-api-hitl-test',
      }),
      db: (handle as FrankDatabaseHandle).db,
    });
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase((handle as FrankDatabaseHandle).db);
  });

  /* ------------------------------------------------------------- helpers --- */

  function authHdr(): string {
    return (server as TestServer).auth(['owner']);
  }

  async function createRunningWorkbench(key: string): Promise<{ id: string; workItemId: string }> {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'POST',
      url: '/v1/workbenches',
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      payload: { command_id: key, task_def: TASK_DEF },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { workbench: { id: string; work_item_id: string } };
    // Move it to `running` so a decision can be requested (HITL-01 pauses a
    // live run). The runner would do this on claim; the test does it directly.
    const store = new WorkbenchStore((handle as FrankDatabaseHandle).db);
    await store.setState(body.workbench.id, 'running', 'test-harness', new Date(), {
      startedAt: new Date(),
    });
    return { id: body.workbench.id, workItemId: body.workbench.work_item_id };
  }

  async function requestDecision(wbId: string, commandId: string) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'POST',
      url: `/v1/workbenches/${wbId}/decisions`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: {
        command_id: commandId,
        question: 'May I promote the schema change to the shared folder?',
        why_now: 'The comparison sheet is ready and the window closes tonight.',
        next_safe_action: 'Approve the staged write.',
        evidence: ['diff: schema.sql (+12 -3)', 'test-results.json'],
      },
    });
  }

  async function getWorkbench(wbId: string) {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/workbenches/${wbId}`,
      headers: { authorization: authHdr() },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { workbench: { state: string }; receipt: { summary: string } | null };
  }

  async function getWorkItem(itemId: string) {
    const target = server as TestServer;
    const res = await target.app.inject({
      method: 'GET',
      url: `/v1/work/${itemId}`,
      headers: { authorization: authHdr() },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { state: string; kind: string; version: number };
  }

  async function sendCommand(itemId: string, command: 'ready' | 'cancel', commandId: string, expectedVersion: number) {
    const target = server as TestServer;
    return target.app.inject({
      method: 'POST',
      url: `/v1/work/${itemId}/commands/${command}`,
      headers: {
        authorization: authHdr(),
        'content-type': 'application/json',
        'idempotency-key': commandId,
      },
      payload: {
        command_id: commandId,
        expected_version: expectedVersion,
        reason: command === 'ready' ? 'approved by steven' : 'denied by steven',
      },
    });
  }

  async function eventTypes(wbId: string): Promise<string[]> {
    const rows = await (handle as FrankDatabaseHandle).db.execute<{ type: string }>(sql`
      select type from "frank_domain"."workbench_event"
      where workbench_id = ${wbId} order by seq
    `);
    return rows.rows.map((r) => r.type);
  }

  /* ------------------------------------------------------------- HITL-01 --- */

  it('HITL-01: a decision request creates a normal waiting decision item and pauses the run', async () => {
    const wb = await createRunningWorkbench('hitl-req-1');

    const res = await requestDecision(wb.id, 'hitl-req-1-cmd');
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      decision_work_item_id: string;
      workbench_id: string;
      workbench_state: string;
    };
    expect(body.workbench_id).toBe(wb.id);
    expect(body.workbench_state).toBe('waiting');

    // The workbench paused.
    const detail = await getWorkbench(wb.id);
    expect(detail.workbench.state).toBe('waiting');

    // The decision is a NORMAL decision work item in waiting (ADR-022 shape).
    const item = await getWorkItem(body.decision_work_item_id);
    expect(item.kind).toBe('decision');
    expect(item.state).toBe('waiting');

    // Durable events: decision_requested then paused.
    const types = await eventTypes(wb.id);
    expect(types).toContain('decision_requested');
    expect(types).toContain('paused');
    expect(types.indexOf('decision_requested')).toBeLessThan(types.indexOf('paused'));
  });

  it('HITL-01: a second decision while one is open is refused (409)', async () => {
    const wb = await createRunningWorkbench('hitl-req-2');
    const first = await requestDecision(wb.id, 'hitl-req-2-cmd');
    expect(first.statusCode).toBe(200);

    const second = await requestDecision(wb.id, 'hitl-req-2-cmd-b');
    expect(second.statusCode).toBe(409);
  });

  /* ------------------------------------------------------------- HITL-02 --- */

  it('HITL-02: ready command resumes the workbench through the normal envelope', async () => {
    const wb = await createRunningWorkbench('hitl-resume');
    const decision = await requestDecision(wb.id, 'hitl-resume-cmd');
    const decisionId = (decision.json() as { decision_work_item_id: string }).decision_work_item_id;
    const item = await getWorkItem(decisionId);

    // Resolve through the NORMAL command envelope on the decision work item.
    const res = await sendCommand(decisionId, 'ready', 'hitl-resume-ready', item.version);
    expect(res.statusCode).toBe(200);

    // The decision item moved to ready and the workbench resumed.
    const itemAfter = await getWorkItem(decisionId);
    expect(itemAfter.state).toBe('ready');
    const detail = await getWorkbench(wb.id);
    expect(detail.workbench.state).toBe('running');
    const types = await eventTypes(wb.id);
    expect(types).toContain('resumed');
  });

  it('HITL-02: cancel command safe-fails with an honest receipt', async () => {
    const wb = await createRunningWorkbench('hitl-deny');
    const decision = await requestDecision(wb.id, 'hitl-deny-cmd');
    const decisionId = (decision.json() as { decision_work_item_id: string }).decision_work_item_id;
    const item = await getWorkItem(decisionId);

    const res = await sendCommand(decisionId, 'cancel', 'hitl-deny-cancel', item.version);
    expect(res.statusCode).toBe(200);

    const itemAfter = await getWorkItem(decisionId);
    expect(itemAfter.state).toBe('cancelled');

    const detail = await getWorkbench(wb.id);
    expect(detail.workbench.state).toBe('failed');
    expect(detail.receipt).not.toBeNull();
    expect(String(detail.receipt?.summary)).toMatch(/denied/i);
    const types = await eventTypes(wb.id);
    expect(types).toContain('failed');
    expect(types).toContain('receipt_published');
  });

  it('HITL-02: a stale expected_version is rejected — no double resolution', async () => {
    const wb = await createRunningWorkbench('hitl-stale');
    const decision = await requestDecision(wb.id, 'hitl-stale-cmd');
    const decisionId = (decision.json() as { decision_work_item_id: string }).decision_work_item_id;
    const item = await getWorkItem(decisionId);

    // First resolution lands.
    const first = await sendCommand(decisionId, 'ready', 'hitl-stale-1', item.version);
    expect(first.statusCode).toBe(200);

    // A replay with the SAME (now stale) expected_version must fail safely.
    const second = await sendCommand(decisionId, 'ready', 'hitl-stale-2', item.version);
    expect([409, 422]).toContain(second.statusCode);

    // Exactly one resume happened.
    const types = await eventTypes(wb.id);
    expect(types.filter((t) => t === 'resumed')).toHaveLength(1);
    const detail = await getWorkbench(wb.id);
    expect(detail.workbench.state).toBe('running');
  });
});
