import { describe, expect, it } from 'vitest';

import { isMissionTerminal } from './types';
import { mapMissionSnapshot, mapMissionStop } from './wire';

const MISSION = {
  id: 'mission-1',
  room_id: 'room-1',
  room_name: 'Launch research',
  objective: 'Research the launch market and publish a supported recommendation.',
  state: 'running',
  stop_new_work: false,
  created_at: '2026-08-09T02:00:00.000Z',
  updated_at: '2026-08-09T02:01:00.000Z',
  completed_at: null,
  last_error: null,
  budget: {
    spend_cap_usd: 20,
    token_budget: 100_000,
    wall_clock_sec: 3_600,
    max_attempts: 3,
  },
};

describe('mission wire mapping', () => {
  it('maps the durable mission and work graph to client types', () => {
    const snapshot = mapMissionSnapshot({
      mission: MISSION,
      work_graph: [
        {
          work_item_id: 'work-1',
          title: 'Collect market evidence',
          state: 'doing',
          depends_on: [],
          workbench_id: 'workbench-1',
          workbench_state: 'running',
          attempts: 1,
          model_tier: 'cheap',
        },
        {
          work_item_id: 'work-2',
          title: 'Publish the recommendation',
          state: 'pending',
          depends_on: ['work-1'],
          workbench_id: null,
          workbench_state: null,
          attempts: 0,
          model_tier: 'strong',
        },
      ],
      identifiers: { request_id: 'request-1' },
    });

    expect(snapshot.mission).toMatchObject({
      id: 'mission-1',
      roomId: 'room-1',
      roomName: 'Launch research',
      state: 'running',
      stopNewWork: false,
      budget: {
        spendCapUsd: 20,
        tokenBudget: 100_000,
        wallClockSec: 3_600,
        maxAttempts: 3,
      },
    });
    expect(snapshot.workGraph).toEqual([
      {
        workItemId: 'work-1',
        title: 'Collect market evidence',
        state: 'doing',
        dependsOn: [],
        workbenchId: 'workbench-1',
        workbenchState: 'running',
        attempts: 1,
        modelTier: 'cheap',
      },
      {
        workItemId: 'work-2',
        title: 'Publish the recommendation',
        state: 'pending',
        dependsOn: ['work-1'],
        workbenchId: null,
        workbenchState: null,
        attempts: 0,
        modelTier: 'strong',
      },
    ]);
  });

  it('maps stop responses without inventing a work graph', () => {
    expect(
      mapMissionStop({
        mission: { ...MISSION, state: 'cancelled', stop_new_work: true },
        identifiers: {},
      }),
    ).toMatchObject({ mission: { state: 'cancelled', stopNewWork: true } });
  });

  it('recognizes only durable terminal states', () => {
    expect(isMissionTerminal('running')).toBe(false);
    expect(isMissionTerminal('waiting')).toBe(false);
    expect(isMissionTerminal('completed')).toBe(true);
    expect(isMissionTerminal('failed')).toBe(true);
    expect(isMissionTerminal('cancelled')).toBe(true);
  });
});
