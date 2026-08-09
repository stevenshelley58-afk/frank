import { describe, expect, it } from 'vitest';

import { mapDomainWorkbenchDetail, mapDomainWorkbenchList } from './wire';

const WORKBENCH = {
  id: '3d6357bd-f8c6-473b-8290-8a5bdc92b631',
  cell_id: 'cell-1',
  work_item_id: 'work-item-1',
  room_id: 'central',
  idempotency_key: 'command-1',
  task_def: { instruction: 'Build the durable report\nInclude evidence.' },
  state: 'running',
  attempts: 2,
  container_id: null,
  schedule: null,
  version: 4,
  created_at: '2026-08-09T01:00:00.000Z',
  updated_at: '2026-08-09T01:01:00.000Z',
  started_at: '2026-08-09T01:00:10.000Z',
  finished_at: null,
  last_error: null,
};

describe('Workbench Domain API wire mapping', () => {
  it('maps snake_case room-list records into the console shape', () => {
    expect(mapDomainWorkbenchList({ workbenches: [WORKBENCH] })).toEqual({
      workbenches: [
        expect.objectContaining({
          id: WORKBENCH.id,
          workItemId: 'work-item-1',
          roomId: 'central',
          state: 'running',
          version: 4,
          attempts: 2,
          task: {
            title: 'Build the durable report',
            goal: 'Build the durable report\nInclude evidence.',
          },
          taskDef: { instruction: 'Build the durable report\nInclude evidence.' },
          createdAt: '2026-08-09T01:00:00.000Z',
          updatedAt: '2026-08-09T01:01:00.000Z',
          startedAt: '2026-08-09T01:00:10.000Z',
          finishedAt: null,
          lastError: null,
        }),
      ],
    });
  });

  it('maps durable plan steps and the latest receipt', () => {
    const detail = mapDomainWorkbenchDetail({
      workbench: WORKBENCH,
      plan: [
        {
          seq: 1,
          step: 'Collect evidence',
          state: 'done',
          note: 'Three sources captured.',
          updated_at: '2026-08-09T01:02:00.000Z',
        },
      ],
      receipt: {
        summary: 'The report was published.',
        assumptions: ['The input was complete.'],
        evidence: [{ artifact_id: 'artifact-1' }, 'https://preview.frank.fail/report-v1/'],
        published_at: '2026-08-09T01:03:00.000Z',
        published_by: 'workbench-runner',
      },
    });

    expect(detail.plan).toEqual([
      {
        seq: 1,
        step: 'Collect evidence',
        state: 'done',
        note: 'Three sources captured.',
        updatedAt: '2026-08-09T01:02:00.000Z',
      },
    ]);
    expect(detail.receipt).toEqual({
      summary: 'The report was published.',
      assumptions: ['The input was complete.'],
      evidence: [
        '{"artifact_id":"artifact-1"}',
        'https://preview.frank.fail/report-v1/',
      ],
      publishedAt: '2026-08-09T01:03:00.000Z',
      publishedBy: 'workbench-runner',
    });
  });
});
