import { createHash } from 'node:crypto';

import type { FrankDatabase } from '@frank/adapter-postgres';
import type { HarnessJobInput } from '@frank/contracts';
import { describe, expect, it, vi } from 'vitest';

import { HarnessJobStore } from './harness-job-store.js';

const request: HarnessJobInput = {
  idempotency_key: 'job-1', harness: 'hermes', task_type: 'browser-research', scope: {},
  input: { query: 'Frank', max_sources: 5 }, allowed_tools: ['browser.search'], egress_profile: 'research-public',
};
const hash = createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex');
const row = {
  id: '00000000-0000-0000-0000-000000000001', status: 'queued', request_hash: hash,
  created_at: '2026-08-11T00:00:00Z', updated_at: '2026-08-11T00:00:00Z',
  finished_at: null, cancelled_at: null, receipt: null, inserted: false,
};

function database(...results: unknown[][]): { db: FrankDatabase; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn();
  for (const rows of results) execute.mockResolvedValueOnce({ rows });
  const candidate = { execute } as { execute: typeof execute; transaction?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
  candidate.transaction = async (fn) => fn(candidate);
  return { db: candidate as unknown as FrankDatabase, execute };
}

describe('HarnessJobStore control-plane invariants', () => {
  it('returns exact replay and refuses a reused key with another request hash', async () => {
    const replay = database([row]);
    await expect(new HarnessJobStore(replay.db).create({ cellId: 'cell-a', ownerId: 'user/a', request }))
      .resolves.toMatchObject({ replayed: true, job: { job_id: row.id, status: 'queued' } });

    const conflict = database([{ ...row, request_hash: '0'.repeat(64) }]);
    await expect(new HarnessJobStore(conflict.db).create({ cellId: 'cell-a', ownerId: 'user/a', request }))
      .rejects.toMatchObject({ failure: 'idempotency_conflict' });
  });

  it('returns ordered resumable events and the exact next cursor', async () => {
    const fake = database([row], [
      { job_id: row.id, cursor: 4, kind: 'progress', payload: { summary: 'working' }, occurred_at: '2026-08-11T00:01:00Z' },
      { job_id: row.id, cursor: 5, kind: 'terminal', payload: { status: 'completed' }, occurred_at: '2026-08-11T00:02:00Z' },
    ]);
    const result = await new HarnessJobStore(fake.db).events({ cellId: 'cell-a', ownerId: 'user/a', jobId: row.id, afterCursor: 3, limit: 50 });
    expect(result.events.map((event) => event.cursor)).toEqual([4, 5]);
    expect(result.nextCursor).toBe(5);
  });

  it('durably records a first cancellation request for a terminal job without rewriting it', async () => {
    const completed = { ...row, status: 'completed' as const, finished_at: '2026-08-11T00:02:00Z' };
    const request = { idempotency_key: 'cancel-1', reason: 'too late' };
    const cancellationHash = createHash('sha256')
      .update(JSON.stringify({ job_id: row.id, ...request }), 'utf8')
      .digest('hex');
    const fake = database([completed], [{ job_id: row.id }], [{ idempotency_key: request.idempotency_key, request_hash: cancellationHash }]);
    const result = await new HarnessJobStore(fake.db).cancel({ cellId: 'cell-a', ownerId: 'user/a', jobId: row.id, requestedBy: 'user/a', request });
    expect(result).toMatchObject({ replayed: false, job: { status: 'completed' } });
    expect(fake.execute).toHaveBeenCalledTimes(3);
  });

  it('replays the same terminal cancellation and rejects a different request', async () => {
    const completed = { ...row, status: 'failed' as const, finished_at: '2026-08-11T00:02:00Z' };
    const request = { idempotency_key: 'cancel-1' };
    const cancellationHash = createHash('sha256')
      .update(JSON.stringify({ job_id: row.id, ...request }), 'utf8')
      .digest('hex');
    const replay = database([completed], [], [{ idempotency_key: request.idempotency_key, request_hash: cancellationHash }]);
    await expect(new HarnessJobStore(replay.db).cancel({ cellId: 'cell-a', ownerId: 'user/a', jobId: row.id, requestedBy: 'user/a', request }))
      .resolves.toMatchObject({ replayed: true, job: { status: 'failed' } });

    const conflict = database([completed], [], [{ idempotency_key: request.idempotency_key, request_hash: cancellationHash }]);
    await expect(new HarnessJobStore(conflict.db).cancel({ cellId: 'cell-a', ownerId: 'user/a', jobId: row.id, requestedBy: 'user/a', request: { idempotency_key: 'cancel-2' } }))
      .rejects.toMatchObject({ failure: 'idempotency_conflict' });
  });

  it('uses the same not-found result for absent and unauthorized ownership', async () => {
    const fake = database([]);
    await expect(new HarnessJobStore(fake.db).get('cell-a', 'user/a', row.id))
      .rejects.toMatchObject({ failure: 'not_found' });
  });
});
