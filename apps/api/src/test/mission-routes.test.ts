import { afterEach, describe, expect, it, vi } from 'vitest';

import { MissionAlreadyTerminalError } from '../services/missions/orchestrator.js';
import type {
  CreateMissionInput,
  MissionView,
  StopMissionInput,
} from '../services/missions/types.js';
import { buildTestServer, TEST_CELL } from './harness.js';
import type { TestServer } from './harness.js';

const MISSION_ID = '01989f1a-1f00-7000-8000-000000000001';
const ROOM_ID = '01989f1a-1f00-7000-8000-000000000002';
const WORK_ITEM_ID = '01989f1a-1f00-7000-8000-000000000003';
const WORKBENCH_ID = '01989f1a-1f00-7000-8000-000000000004';

const runningMission: MissionView = {
  mission: {
    id: MISSION_ID,
    room_id: ROOM_ID,
    room_name: 'Workbench completion',
    objective: 'Finish the durable workbench end to end.',
    state: 'running',
    stop_new_work: false,
    created_at: '2026-08-09T01:00:00.000Z',
    updated_at: '2026-08-09T01:00:01.000Z',
    completed_at: null,
    last_error: null,
    budget: {
      spend_cap_usd: 20,
      token_budget: 250_000,
      wall_clock_sec: 3_600,
      max_attempts: 3,
    },
  },
  work_graph: [
    {
      work_item_id: WORK_ITEM_ID,
      title: 'Inspect the current implementation',
      state: 'active',
      depends_on: [],
      workbench_id: WORKBENCH_ID,
      workbench_state: 'running',
      attempts: 1,
      model_tier: 'cheap',
    },
  ],
};

let server: TestServer | undefined;

afterEach(async () => {
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
});

function start(overrides: {
  create?: (input: CreateMissionInput) => Promise<MissionView>;
  get?: (cellId: string, missionId: string) => Promise<MissionView | null>;
  stop?: (input: StopMissionInput) => Promise<MissionView>;
} = {}) {
  const create = vi.fn(overrides.create ?? (async () => runningMission));
  const get = vi.fn(overrides.get ?? (async () => runningMission));
  const stop = vi.fn(
    overrides.stop ??
      (async () => ({
        ...runningMission,
        mission: {
          ...runningMission.mission,
          state: 'cancelled' as const,
          stop_new_work: true,
          completed_at: '2026-08-09T01:05:00.000Z',
          last_error: 'Stopped by owner request.',
        },
      })),
  );
  server = buildTestServer({ missionOrchestrator: { create, get, stop } });
  return { server, create, get, stop };
}

describe('mission routes', () => {
  it('creates a mission, maps camel-case service input, and returns public graph nodes', async () => {
    const target = start();
    const response = await target.server.app.inject({
      method: 'POST',
      url: '/v1/missions',
      headers: { authorization: target.server.auth(['owner']), 'content-type': 'application/json' },
      payload: {
        command_id: 'command-create-mission-1',
        objective: 'Finish the durable workbench end to end.',
        title: 'Finish the workbench',
        room_name: 'Workbench completion',
        budget: {
          spend_cap_usd: 20,
          token_budget: 250_000,
          wall_clock_sec: 3_600,
          max_attempts: 3,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body['work_graph']).toEqual(runningMission.work_graph);
    expect(body['mission']).not.toHaveProperty('work_graph');
    expect(body['identifiers']).toMatchObject({ cell_id: TEST_CELL, actor_id: 'user/steven' });
    expect(target.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cellId: TEST_CELL,
        commandId: 'command-create-mission-1',
        roomName: 'Workbench completion',
        budget: {
          spendCapUsd: 20,
          tokenBudget: 250_000,
          wallClockSec: 3_600,
          maxAttempts: 3,
        },
        actor: { kind: 'user', id: 'user/steven' },
      }),
    );
  });

  it('allows read-capable reviewers to load a mission but not create one', async () => {
    const target = start();
    const read = await target.server.app.inject({
      method: 'GET',
      url: `/v1/missions/${MISSION_ID}`,
      headers: { authorization: target.server.auth(['reviewer']) },
    });
    expect(read.statusCode).toBe(200);
    expect(target.get).toHaveBeenCalledWith(TEST_CELL, MISSION_ID);

    const create = await target.server.app.inject({
      method: 'POST',
      url: '/v1/missions',
      headers: { authorization: target.server.auth(['reviewer']), 'content-type': 'application/json' },
      payload: {
        command_id: 'command-reviewer-create',
        objective: 'This reviewer must not create a mission.',
      },
    });
    expect(create.statusCode).toBe(403);
  });

  it('requires agreeing transport idempotency keys before stop reaches the orchestrator', async () => {
    const target = start();
    const response = await target.server.app.inject({
      method: 'POST',
      url: `/v1/missions/${MISSION_ID}/stop`,
      headers: {
        authorization: target.server.auth(['owner']),
        'content-type': 'application/json',
        'idempotency-key': 'command-stop-header',
      },
      payload: { command_id: 'command-stop-body', reason: 'Stop at the owner boundary.' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      type: 'https://frank.fail/problems/idempotency-conflict',
    });
    expect(target.stop).not.toHaveBeenCalled();
  });

  it('maps terminal stop conflicts to an honest transition error', async () => {
    const target = start({
      stop: async () => {
        throw new MissionAlreadyTerminalError(MISSION_ID, 'completed');
      },
    });
    const response = await target.server.app.inject({
      method: 'POST',
      url: `/v1/missions/${MISSION_ID}/stop`,
      headers: { authorization: target.server.auth(['owner']), 'content-type': 'application/json' },
      payload: { command_id: 'command-stop-terminal', reason: 'Stop at the owner boundary.' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      type: 'https://frank.fail/problems/invalid-transition',
    });
    expect(target.stop).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'command-stop-terminal' }),
    );
  });
});
