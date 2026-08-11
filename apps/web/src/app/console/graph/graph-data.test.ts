import { describe, expect, it, vi } from 'vitest';

import {
  createRefreshCommandId,
  fetchBoundedOverview,
  fetchGraphJob,
  fetchGraphSnapshot,
  fetchGraphView,
  fetchProjects,
  pollGraphRefresh,
  requestGraphRefresh,
  type BoundedOverview,
  type GraphJob,
  type GraphStatus,
} from './graph-data';

const JOB_ID = '22222222222222222222222222222222';
const COMMAND_ID = 'graph-refresh-command-1';
const COALESCED_COMMAND_ID = 'graph-refresh-command-2';
const BFF_BASE = '/api/v1/codegraph';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const readyStatus: GraphStatus = {
  project_id: 'frank',
  state: 'ready',
  generated_at: '2026-08-11T02:00:00.000Z',
  node_count: 2,
  edge_count: 1,
  build: {
    building: false,
    queued: false,
    initial_complete: true,
    last_success_at: '2026-08-11T02:00:00.000Z',
    has_error: false,
    active_job: null,
    recent_jobs: [],
  },
};

const completedJob: GraphJob = {
  job_id: JOB_ID,
  state: 'succeeded',
  requested_at: '2026-08-11T02:00:30.000Z',
  started_at: '2026-08-11T02:00:31.000Z',
  completed_at: '2026-08-11T02:01:00.000Z',
  command_id: COMMAND_ID,
  command_ids: null,
  release: '20260811T020100Z-22222222',
  has_error: false,
};

function jobResponse(job: GraphJob): Response {
  return jsonResponse({ project_id: 'frank', job });
}

function refreshResponse(commandId: string): Response {
  return jsonResponse(
    {
      project_id: 'frank',
      job_id: JOB_ID,
      state: 'queued',
      command_id: commandId,
      requested_at: '2026-08-11T02:00:30.000Z',
    },
    202,
  );
}

const boundedOverview: BoundedOverview = {
  project_id: 'frank',
  truncated: true,
  total_nodes: 420,
  total_edges: 900,
  spec: {
    id: 'frank.overview',
    title: 'Frank overview',
    nodes: [
      { id: 'project', kind: 'data', title: 'Project' },
      { id: 'module', kind: 'process', title: 'Module' },
    ],
    edges: [{ id: 'project-module', source: 'project', target: 'module' }],
  },
};

describe('bounded Graphify API client', () => {
  it('routes every graph request through the authenticated BFF', async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
      requested.push(input);
      if (input.endsWith('/projects')) {
        return jsonResponse({
          projects: [
            {
              id: 'frank',
              name: 'Frank Monorepo',
              available: true,
              generated_at: readyStatus.generated_at,
            },
          ],
        });
      }
      if (input.includes('/jobs/')) return jobResponse(completedJob);
      if (init?.method === 'POST') return refreshResponse(COMMAND_ID);
      if (input.endsWith('/status')) return jsonResponse(readyStatus);
      if (input.endsWith('/overview')) return jsonResponse(boundedOverview);
      throw new Error(`Unexpected request: ${input}`);
    });

    await fetchProjects(fetcher);
    await fetchGraphSnapshot('frank', fetcher);
    await fetchGraphJob('frank', JOB_ID, fetcher);
    await requestGraphRefresh('frank', fetcher, COMMAND_ID);

    expect(requested).toHaveLength(5);
    expect(requested.every((url) => url.startsWith('/api/v1/codegraph'))).toBe(true);
    expect(requested.some((url) => url.startsWith('/v1/codegraph'))).toBe(false);
  });

  it('loads a snapshot from status and bounded overview only', async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string): Promise<Response> => {
      requested.push(input);
      if (input.endsWith('/status')) return jsonResponse(readyStatus);
      if (input.endsWith('/overview')) return jsonResponse(boundedOverview);
      throw new Error(`Unexpected request: ${input}`);
    });

    const snapshot = await fetchGraphSnapshot('frank', fetcher);

    expect(snapshot.overview.truncated).toBe(true);
    expect(requested).toEqual([
      `${BFF_BASE}/frank/status`,
      `${BFF_BASE}/frank/overview`,
    ]);
    expect(requested.some((url) => url.endsWith('/spec') || url.endsWith('/graph'))).toBe(false);
  });

  it('loads queued first-build status without requesting an unavailable overview', async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string): Promise<Response> => {
      requested.push(input);
      return jsonResponse({
        ...readyStatus,
        state: 'queued',
        generated_at: null,
        node_count: 0,
        edge_count: 0,
        build: {
          ...readyStatus.build,
          queued: true,
          initial_complete: false,
          active_job: { ...completedJob, state: 'queued', completed_at: null, release: null },
        },
      });
    });

    const view = await fetchGraphView('frank', fetcher);

    expect(view.status.state).toBe('queued');
    expect(view.overview).toBeNull();
    expect(requested).toEqual([`${BFF_BASE}/frank/status`]);
  });

  it('refuses an overview that exceeds the client render bound', async () => {
    const oversized = {
      ...boundedOverview,
      spec: {
        ...boundedOverview.spec,
        nodes: Array.from({ length: 101 }, (_, index) => ({
          id: `node-${index}`,
          kind: 'data',
          title: `Node ${index}`,
        })),
      },
    };
    const fetcher = vi.fn(async (): Promise<Response> => jsonResponse(oversized));

    await expect(fetchBoundedOverview('frank', fetcher)).rejects.toThrow(
      'exceeded the 100-node/200-edge render limit',
    );
  });

  it('accepts at most 256 coalesced command memberships per job', async () => {
    const boundedMembership = [
      COMMAND_ID,
      ...Array.from({ length: 255 }, (_, index) => `coalesced-command-${index}`),
    ];
    const acceptedFetcher = vi.fn(async (): Promise<Response> =>
      jobResponse({ ...completedJob, command_ids: boundedMembership }),
    );

    const accepted = await fetchGraphJob('frank', JOB_ID, acceptedFetcher);

    expect(accepted.command_ids).toHaveLength(256);

    const oversizedFetcher = vi.fn(async (): Promise<Response> =>
      jobResponse({
        ...completedJob,
        command_ids: [...boundedMembership, 'coalesced-command-overflow'],
      }),
    );
    await expect(fetchGraphJob('frank', JOB_ID, oversizedFetcher)).rejects.toThrow(
      'bounded API contract',
    );
  });
});

describe('Graphify refresh', () => {
  it('creates unique command IDs and sends the selected ID in JSON', async () => {
    let sequence = 0;
    const first = createRefreshCommandId(() => `uuid-${++sequence}`);
    const second = createRefreshCommandId(() => `uuid-${++sequence}`);
    const fetcher = vi.fn(async (): Promise<Response> => refreshResponse(first));

    const receipt = await requestGraphRefresh('frank', fetcher, first);

    expect(first).not.toBe(second);
    expect(receipt).toMatchObject({ job_id: JOB_ID, state: 'queued', command_id: first });
    expect(fetcher).toHaveBeenCalledWith(
      `${BFF_BASE}/frank/refresh`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': first,
        }),
        body: JSON.stringify({ command_id: first }),
      }),
    );
  });

  it('does not treat a non-202 refresh response as queued', async () => {
    const fetcher = vi.fn(async (): Promise<Response> =>
      jsonResponse({ job_id: JOB_ID, state: 'queued', message: 'not queued' }, 200),
    );

    await expect(requestGraphRefresh('frank', fetcher, 'graph-refresh-command-1')).rejects.toThrow(
      'Queueing graph refresh failed (200)',
    );
  });

  it('polls the exact queued and running job before loading the completed overview', async () => {
    const jobs: GraphJob[] = [
      { ...completedJob, state: 'queued', started_at: null, completed_at: null, release: null },
      { ...completedJob, state: 'running', completed_at: null, release: null },
      completedJob,
    ];
    const requested: string[] = [];
    const progress: string[] = [];
    const wait = vi.fn(async () => undefined);
    const fetcher = vi.fn(async (input: string): Promise<Response> => {
      requested.push(input);
      if (input.includes('/jobs/')) return jobResponse(jobs.shift()!);
      if (input.endsWith('/status')) {
        return jsonResponse({ ...readyStatus, generated_at: '2026-08-11T02:01:00.000Z' });
      }
      if (input.endsWith('/overview')) return jsonResponse(boundedOverview);
      throw new Error(`Unexpected request: ${input}`);
    });

    const snapshot = await pollGraphRefresh({
      projectId: 'frank',
      receipt: {
        project_id: 'frank',
        job_id: JOB_ID,
        state: 'queued',
        command_id: COMMAND_ID,
        requested_at: completedJob.requested_at!,
      },
      signal: new AbortController().signal,
      fetcher,
      wait,
      onProgress: (phase) => progress.push(phase),
    });

    expect(progress).toEqual(['queued', 'building']);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(snapshot.status.generated_at).toBe('2026-08-11T02:01:00.000Z');
    expect(requested).toEqual([
      `${BFF_BASE}/frank/jobs/${JOB_ID}`,
      `${BFF_BASE}/frank/jobs/${JOB_ID}`,
      `${BFF_BASE}/frank/jobs/${JOB_ID}`,
      `${BFF_BASE}/frank/status`,
      `${BFF_BASE}/frank/overview`,
    ]);
  });

  it('keeps the succeeded first-build job active until its bounded overview appears', async () => {
    let overviewAttempts = 0;
    let statusAttempts = 0;
    const progress: string[] = [];
    const fetcher = vi.fn(async (input: string): Promise<Response> => {
      if (input.includes('/jobs/')) return jobResponse(completedJob);
      if (input.endsWith('/status')) {
        statusAttempts += 1;
        return jsonResponse(
          statusAttempts === 1
            ? {
                ...readyStatus,
                state: 'unavailable',
                generated_at: null,
                node_count: 0,
                edge_count: 0,
                build: { ...readyStatus.build, initial_complete: false },
              }
            : readyStatus,
        );
      }
      overviewAttempts += 1;
      return overviewAttempts === 1
        ? jsonResponse({ detail: 'No published graph exists yet.' }, 404)
        : jsonResponse({ ...boundedOverview, truncated: false });
    });

    const snapshot = await pollGraphRefresh({
      projectId: 'frank',
      receipt: {
        project_id: 'frank',
        job_id: JOB_ID,
        state: 'queued',
        command_id: COMMAND_ID,
        requested_at: completedJob.requested_at!,
      },
      signal: new AbortController().signal,
      fetcher,
      wait: async () => undefined,
      onProgress: (phase) => progress.push(phase),
    });

    expect(progress).toEqual(['building']);
    expect(snapshot.status.state).toBe('ready');
    expect(snapshot.job.job_id).toBe(JOB_ID);
  });

  it('stops polling when the exact rebuild job fails', async () => {
    const fetcher = vi.fn(async (): Promise<Response> =>
      jobResponse({ ...completedJob, state: 'failed', has_error: true }),
    );
    const wait = vi.fn(async () => undefined);

    await expect(
      pollGraphRefresh({
        projectId: 'frank',
        receipt: {
          project_id: 'frank',
          job_id: JOB_ID,
          state: 'queued',
          command_id: COMMAND_ID,
          requested_at: completedJob.requested_at!,
        },
        signal: new AbortController().signal,
        fetcher,
        wait,
      }),
    ).rejects.toThrow('rebuild job failed');
    expect(wait).not.toHaveBeenCalled();
  });

  it('accepts a coalesced job only when its command membership contains the receipt', async () => {
    const sharedJob = {
      ...completedJob,
      command_id: undefined,
      command_ids: [COMMAND_ID, COALESCED_COMMAND_ID],
    };
    const fetcher = vi.fn(async (input: string): Promise<Response> => {
      if (input.includes('/jobs/')) {
        return jsonResponse({ project_id: 'frank', job: sharedJob });
      }
      if (input.endsWith('/status')) return jsonResponse(readyStatus);
      return jsonResponse(boundedOverview);
    });

    const pollForCommand = (commandId: string) =>
      pollGraphRefresh({
        projectId: 'frank',
        receipt: {
          project_id: 'frank',
          job_id: JOB_ID,
          state: 'queued',
          command_id: commandId,
          requested_at: completedJob.requested_at!,
        },
        signal: new AbortController().signal,
        fetcher,
        wait: async () => undefined,
      });

    const firstResult = await pollForCommand(COMMAND_ID);
    const secondResult = await pollForCommand(COALESCED_COMMAND_ID);

    expect(firstResult.job.job_id).toBe(secondResult.job.job_id);
    expect(secondResult.job.command_id).toBeNull();
    expect(secondResult.job.command_ids).toEqual([COMMAND_ID, COALESCED_COMMAND_ID]);
  });

  it('rejects a shared job whose membership omits the receipt command', async () => {
    const fetcher = vi.fn(async (): Promise<Response> =>
      jobResponse({
        ...completedJob,
        command_id: null,
        command_ids: [COMMAND_ID],
      }),
    );

    await expect(
      pollGraphRefresh({
        projectId: 'frank',
        receipt: {
          project_id: 'frank',
          job_id: JOB_ID,
          state: 'queued',
          command_id: COALESCED_COMMAND_ID,
          requested_at: completedJob.requested_at!,
        },
        signal: new AbortController().signal,
        fetcher,
        wait: async () => undefined,
      }),
    ).rejects.toThrow('different refresh command');
  });
});
