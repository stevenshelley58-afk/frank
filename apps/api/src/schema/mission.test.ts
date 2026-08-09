import { describe, expect, it } from 'vitest';

import {
  missionCreateBodySchema,
  missionResponseSchema,
  missionStopBodySchema,
} from './mission.js';

const response = {
  mission: {
    id: '01989f1a-1f00-7000-8000-000000000001',
    room_id: '01989f1a-1f00-7000-8000-000000000002',
    room_name: 'Finish the workbench',
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
      work_item_id: '01989f1a-1f00-7000-8000-000000000003',
      title: 'Inspect the current implementation',
      state: 'active',
      depends_on: [],
      workbench_id: '01989f1a-1f00-7000-8000-000000000004',
      workbench_state: 'running',
      attempts: 1,
      model_tier: 'cheap',
    },
  ],
  identifiers: {
    cell_id: 'cell-steven',
    actor_id: 'user/steven',
    request_id: 'request-1',
    correlation_id: 'correlation-1',
    trace_id: 'trace-1',
    policy_version: 'frank.operating-policy/v1',
  },
} as const;

describe('mission wire schemas', () => {
  it('accepts the frozen create and stop bodies', () => {
    expect(
      missionCreateBodySchema.safeParse({
        command_id: 'command-create-1',
        objective: 'Finish the durable workbench end to end.',
        title: 'Finish the workbench',
        room_name: 'Workbench completion',
        budget: {
          spend_cap_usd: 20,
          token_budget: 250_000,
          wall_clock_sec: 3_600,
          max_attempts: 3,
        },
      }).success,
    ).toBe(true);
    expect(
      missionStopBodySchema.safeParse({
        command_id: 'command-stop-1',
        reason: 'The owner requested a stop.',
      }).success,
    ).toBe(true);
  });

  it('accepts short messages and rejects empty objectives, unsafe budget bounds, and unknown fields', () => {
    expect(
      missionCreateBodySchema.safeParse({ command_id: 'command-1', objective: 'hi' }).success,
    ).toBe(true);
    expect(
      missionCreateBodySchema.safeParse({ command_id: 'command-1', objective: '   ' }).success,
    ).toBe(false);
    expect(
      missionCreateBodySchema.safeParse({
        command_id: 'command-1',
        objective: 'A sufficiently substantial objective.',
        budget: { wall_clock_sec: 0, max_attempts: 0 },
      }).success,
    ).toBe(false);
    expect(
      missionStopBodySchema.safeParse({
        command_id: 'command-stop-1',
        reason: 'Stop now.',
        force: true,
      }).success,
    ).toBe(false);
  });

  it('requires the graph to be a bare top-level node array', () => {
    expect(missionResponseSchema.safeParse(response).success).toBe(true);
    expect(
      missionResponseSchema.safeParse({
        ...response,
        work_graph: { summary: 'Private planner prose', nodes: response.work_graph },
      }).success,
    ).toBe(false);
    expect(
      missionResponseSchema.safeParse({
        ...response,
        mission: { ...response.mission, work_graph: response.work_graph },
      }).success,
    ).toBe(false);
  });
});
