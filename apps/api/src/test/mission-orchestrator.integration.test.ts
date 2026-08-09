/** Durable mission lifecycle against the real PostgreSQL schema. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FrankDatabaseHandle } from '@frank/adapter-postgres';

import { MissionOrchestrator } from '../services/missions/orchestrator.js';
import type { MissionPlanningPort } from '../services/missions/orchestrator.js';
import {
  SKIP_REASON,
  ensureApiDatabase,
  openApiTestDatabase,
  requiresDatabase,
  resetApiDatabase,
} from './db-harness.js';

const CELL = 'cell-steven';
const NOW = new Date('2026-08-09T04:00:00.000Z');
const ACTOR = { kind: 'user', id: 'steven' } as const;

const planner: MissionPlanningPort = {
  async plan() {
    return {
      summary: 'Inspect, then verify.',
      tasks: [
        {
          key: 'inspect',
          title: 'Inspect repository',
          instruction: 'Inspect the repository read-only and write evidence.',
          depends_on: [],
          model_tier: 'cheap' as const,
          timeout_seconds: 300,
          verification: 'An evidence file identifies the entrypoints.',
        },
        {
          key: 'verify',
          title: 'Verify evidence',
          instruction: 'Independently verify the inspection evidence.',
          depends_on: ['inspect'],
          model_tier: 'strong' as const,
          timeout_seconds: 300,
          verification: 'The reported entrypoints exist.',
        },
      ],
    };
  },
};

describe.skipIf(requiresDatabase)(SKIP_REASON, () => {
  let handle: FrankDatabaseHandle;
  let orchestrator: MissionOrchestrator;

  beforeAll(async () => {
    await ensureApiDatabase();
    handle = await openApiTestDatabase();
    orchestrator = new MissionOrchestrator({
      db: handle.db,
      planner,
      workspaceSource: '/srv/frank/workspaces/central',
      cheapModel: 'deepseek-v4-flash',
      strongModel: 'deepseek-v4-pro',
    });
  }, 60_000);

  afterAll(async () => {
    await orchestrator?.stopScheduler();
    await handle?.close();
  });

  beforeEach(async () => {
    await resetApiDatabase(handle.db);
  });

  it('creates, replays, reads, and stops a durable mission graph', async () => {
    const input = {
      cellId: CELL,
      commandId: 'mission-create-integration-1',
      objective: 'Inspect the Frank repository and verify the result.',
      budget: {
        spendCapUsd: 1,
        tokenBudget: 10_000,
        wallClockSec: 900,
        maxAttempts: 2,
      },
      actor: ACTOR,
      correlationId: 'corr-mission-integration-1',
      now: NOW,
    };

    const created = await orchestrator.create(input);
    expect(created.mission.state).toBe('running');
    expect(created.mission.room_name).toContain(created.mission.id.slice(0, 8));
    expect(created.work_graph).toHaveLength(2);
    expect(created.work_graph[0]).toMatchObject({
      title: 'Inspect repository',
      state: 'ready',
      workbench_state: 'queued',
      attempts: 1,
      model_tier: 'cheap',
    });
    expect(created.work_graph[1]).toMatchObject({
      title: 'Verify evidence',
      state: 'planned',
      workbench_id: null,
      attempts: 0,
      model_tier: 'strong',
    });

    const replay = await orchestrator.create({
      ...input,
      objective: 'A changed replay body must not create a second mission.',
    });
    expect(replay.mission.id).toBe(created.mission.id);

    const missionCount = await handle.db.execute<{ count: string }>(sql`
      select count(*) as count from "frank_domain"."mission"
      where cell_id = ${CELL} and idempotency_key = ${input.commandId}
    `);
    expect(missionCount.rows[0]?.count).toBe('1');

    const stopped = await orchestrator.stop({
      cellId: CELL,
      missionId: created.mission.id,
      commandId: 'mission-stop-integration-1',
      reason: 'integration verification completed',
      actor: ACTOR,
      correlationId: 'corr-mission-stop-integration-1',
      now: new Date(NOW.getTime() + 1_000),
    });
    expect(stopped.mission).toMatchObject({ state: 'cancelled', stop_new_work: true });
    expect(stopped.mission.completed_at).not.toBeNull();
    expect(stopped.work_graph[0]?.workbench_state).toBe('cancelled');

    const read = await orchestrator.get(CELL, created.mission.id);
    expect(read).toEqual(stopped);
  });
});
