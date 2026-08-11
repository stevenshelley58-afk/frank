import type { PipelineSpec } from '@frank/pipeline-graph';

export const MAX_OVERVIEW_NODES = 100;
export const MAX_OVERVIEW_EDGES = 200;

const CODEGRAPH_API = '/api/v1/codegraph';
const POLL_INTERVAL_MS = 1_500;
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

export type CodegraphProject = {
  id: string;
  name: string;
  available: boolean;
  generated_at: string | null;
};

export type GraphBuildState = 'ready' | 'queued' | 'building' | 'degraded' | 'unavailable';
export type GraphJobState = 'queued' | 'running' | 'succeeded' | 'failed';

export type GraphJob = {
  job_id: string;
  state: GraphJobState;
  requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  command_id: string | null;
  /** Authoritative for coalesced jobs; null when the API supplies only a scalar command_id. */
  command_ids: string[] | null;
  release: string | null;
  has_error: boolean;
};

export type GraphBuildDetails = {
  building: boolean;
  queued: boolean;
  initial_complete: boolean;
  last_success_at: string | null;
  has_error: boolean;
  active_job: GraphJob | null;
  recent_jobs: GraphJob[];
};

export type GraphStatus = {
  project_id: string;
  state: GraphBuildState;
  generated_at: string | null;
  node_count: number;
  edge_count: number;
  build: GraphBuildDetails;
};

export type BoundedOverview = {
  project_id: string;
  truncated: boolean;
  total_nodes: number;
  total_edges: number;
  spec: PipelineSpec;
};

export type GraphSnapshot = {
  status: GraphStatus;
  overview: BoundedOverview;
};

export type GraphView = {
  status: GraphStatus;
  overview: BoundedOverview | null;
};

export type RefreshReceipt = {
  project_id: string;
  job_id: string;
  state: GraphJobState;
  command_id: string;
  requested_at: string;
};

export type GraphRefreshResult = GraphSnapshot & {
  job: GraphJob;
};

export type RefreshPhase = 'queued' | 'building';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type PollRefreshOptions = {
  projectId: string;
  receipt: RefreshReceipt;
  signal: AbortSignal;
  fetcher?: Fetcher;
  wait?: (signal: AbortSignal) => Promise<void>;
  onProgress?: (phase: RefreshPhase, job: GraphJob | null) => void;
};

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GraphApiError';
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function isJobState(value: unknown): value is GraphJobState {
  return ['queued', 'running', 'succeeded', 'failed'].includes(String(value));
}

function isCommandId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function endpoint(projectId: string, suffix: 'status' | 'overview' | 'refresh'): string {
  return `${CODEGRAPH_API}/${encodeURIComponent(projectId)}/${suffix}`;
}

function jobEndpoint(projectId: string, jobId: string): string {
  return `${CODEGRAPH_API}/${encodeURIComponent(projectId)}/jobs/${jobId}`;
}

async function readResponse(response: Response, action: string, expectedStatus = 200): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status !== expectedStatus) {
    const problem = recordOf(body);
    const detail =
      stringOrNull(problem?.detail) ?? stringOrNull(problem?.message) ?? response.statusText;
    throw new GraphApiError(`${action} failed (${response.status})${detail ? `: ${detail}` : ''}`, response.status);
  }

  if (body === null) {
    throw new GraphApiError(`${action} returned an unreadable response.`, response.status);
  }
  return body;
}

function parseJob(value: unknown): GraphJob {
  const record = recordOf(value);
  if (
    typeof record?.job_id !== 'string' ||
    !JOB_ID_PATTERN.test(record.job_id) ||
    !isJobState(record.state) ||
    typeof record.has_error !== 'boolean'
  ) {
    throw new GraphApiError('Graph job did not match the bounded API contract.', 200);
  }
  for (const field of [
    'requested_at',
    'started_at',
    'completed_at',
    'release',
  ] as const) {
    if (record[field] !== null && typeof record[field] !== 'string') {
      throw new GraphApiError('Graph job did not match the bounded API contract.', 200);
    }
  }
  if (
    (record.command_id !== undefined &&
      record.command_id !== null &&
      !isCommandId(record.command_id)) ||
    (record.command_ids !== undefined &&
      record.command_ids !== null &&
      (!Array.isArray(record.command_ids) ||
        record.command_ids.length === 0 ||
        record.command_ids.length > 256 ||
        !record.command_ids.every(isCommandId) ||
        new Set(record.command_ids).size !== record.command_ids.length))
  ) {
    throw new GraphApiError('Graph job did not match the bounded API contract.', 200);
  }
  const commandId = stringOrNull(record.command_id);
  const commandIds = Array.isArray(record.command_ids) ? [...record.command_ids] : null;
  if (commandId !== null && commandIds !== null && !commandIds.includes(commandId)) {
    throw new GraphApiError('Graph job did not match the bounded API contract.', 200);
  }
  return {
    job_id: record.job_id,
    state: record.state,
    requested_at: stringOrNull(record.requested_at),
    started_at: stringOrNull(record.started_at),
    completed_at: stringOrNull(record.completed_at),
    command_id: commandId,
    command_ids: commandIds,
    release: stringOrNull(record.release),
    has_error: record.has_error,
  };
}

function parseStatus(value: unknown): GraphStatus {
  const record = recordOf(value);
  const state = record?.state;
  const nodeCount = nonnegativeInteger(record?.node_count);
  const edgeCount = nonnegativeInteger(record?.edge_count);
  const build = recordOf(record?.build);
  if (
    typeof record?.project_id !== 'string' ||
    !['ready', 'queued', 'building', 'degraded', 'unavailable'].includes(String(state)) ||
    nodeCount === null ||
    edgeCount === null ||
    typeof build?.building !== 'boolean' ||
    typeof build.queued !== 'boolean' ||
    typeof build.initial_complete !== 'boolean' ||
    typeof build.has_error !== 'boolean' ||
    !Array.isArray(build.recent_jobs) ||
    build.recent_jobs.length > 10 ||
    (build.last_success_at !== null && typeof build.last_success_at !== 'string')
  ) {
    throw new GraphApiError('Graph status did not match the bounded API contract.', 200);
  }
  const activeJob = build.active_job === null ? null : parseJob(build.active_job);
  return {
    project_id: record.project_id,
    state: state as GraphBuildState,
    generated_at: stringOrNull(record.generated_at),
    node_count: nodeCount,
    edge_count: edgeCount,
    build: {
      building: build.building,
      queued: build.queued,
      initial_complete: build.initial_complete,
      last_success_at: stringOrNull(build.last_success_at),
      has_error: build.has_error,
      active_job: activeJob,
      recent_jobs: build.recent_jobs.map(parseJob),
    },
  };
}

function parseOverview(value: unknown): BoundedOverview {
  const record = recordOf(value);
  const spec = recordOf(record?.spec);
  const nodes = spec?.nodes;
  const edges = spec?.edges;
  const totalNodes = nonnegativeInteger(record?.total_nodes);
  const totalEdges = nonnegativeInteger(record?.total_edges);
  if (
    typeof record?.project_id !== 'string' ||
    typeof record.truncated !== 'boolean' ||
    totalNodes === null ||
    totalEdges === null ||
    !Array.isArray(nodes) ||
    !Array.isArray(edges)
  ) {
    throw new GraphApiError('Graph overview did not match the bounded API contract.', 200);
  }
  if (nodes.length > MAX_OVERVIEW_NODES || edges.length > MAX_OVERVIEW_EDGES) {
    throw new GraphApiError(
      `Graph overview exceeded the ${MAX_OVERVIEW_NODES}-node/${MAX_OVERVIEW_EDGES}-edge render limit.`,
      200,
    );
  }
  if (totalNodes < nodes.length || totalEdges < edges.length) {
    throw new GraphApiError('Graph overview totals were smaller than the rendered bounded slice.', 200);
  }
  return {
    project_id: record.project_id,
    truncated: record.truncated,
    total_nodes: totalNodes,
    total_edges: totalEdges,
    spec: record.spec as PipelineSpec,
  };
}

export async function fetchProjects(fetcher: Fetcher = fetch): Promise<CodegraphProject[]> {
  const body = recordOf(
    await readResponse(await fetcher(`${CODEGRAPH_API}/projects`, { cache: 'no-store' }), 'Loading projects'),
  );
  if (!Array.isArray(body?.projects)) {
    throw new GraphApiError('Project list did not match the bounded API contract.', 200);
  }
  return body.projects.map((value) => {
    const project = recordOf(value);
    if (
      typeof project?.id !== 'string' ||
      typeof project.name !== 'string' ||
      typeof project.available !== 'boolean'
    ) {
      throw new GraphApiError('Project list did not match the bounded API contract.', 200);
    }
    return {
      id: project.id,
      name: project.name,
      available: project.available,
      generated_at: stringOrNull(project.generated_at),
    };
  });
}

export async function fetchGraphStatus(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<GraphStatus> {
  const status = parseStatus(
    await readResponse(
      await fetcher(endpoint(projectId, 'status'), { cache: 'no-store' }),
      'Loading graph status',
    ),
  );
  if (status.project_id !== projectId) {
    throw new GraphApiError('Graph status did not match the requested project.', 200);
  }
  return status;
}

export async function fetchBoundedOverview(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<BoundedOverview> {
  const overview = parseOverview(
    await readResponse(
      await fetcher(endpoint(projectId, 'overview'), { cache: 'no-store' }),
      'Loading bounded graph overview',
    ),
  );
  if (overview.project_id !== projectId) {
    throw new GraphApiError('Graph overview did not match the requested project.', 200);
  }
  return overview;
}

export async function fetchGraphSnapshot(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<GraphSnapshot> {
  const [status, overview] = await Promise.all([
    fetchGraphStatus(projectId, fetcher),
    fetchBoundedOverview(projectId, fetcher),
  ]);
  return { status, overview };
}

export async function fetchGraphView(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<GraphView> {
  const status = await fetchGraphStatus(projectId, fetcher);
  if (status.node_count === 0) return { status, overview: null };
  return { status, overview: await fetchBoundedOverview(projectId, fetcher) };
}

export async function fetchGraphJob(
  projectId: string,
  jobId: string,
  fetcher: Fetcher = fetch,
): Promise<GraphJob> {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new GraphApiError('Graph job ID did not match the bounded API contract.', 400);
  }
  const body = recordOf(
    await readResponse(
      await fetcher(jobEndpoint(projectId, jobId), { cache: 'no-store' }),
      'Loading graph rebuild job',
    ),
  );
  const job = parseJob(body?.job);
  if (body?.project_id !== projectId || job.job_id !== jobId) {
    throw new GraphApiError('Graph job did not match the requested project and job.', 200);
  }
  return job;
}

export function createRefreshCommandId(randomUuid: () => string = () => crypto.randomUUID()): string {
  return `graph-refresh-${randomUuid()}`;
}

export async function requestGraphRefresh(
  projectId: string,
  fetcher: Fetcher = fetch,
  commandId = createRefreshCommandId(),
): Promise<RefreshReceipt> {
  const body = recordOf(
    await readResponse(
      await fetcher(endpoint(projectId, 'refresh'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': commandId,
        },
        body: JSON.stringify({ command_id: commandId }),
      }),
      'Queueing graph refresh',
      202,
    ),
  );
  if (
    body?.project_id !== projectId ||
    typeof body.job_id !== 'string' ||
    !JOB_ID_PATTERN.test(body.job_id) ||
    !isJobState(body.state) ||
    body.command_id !== commandId ||
    typeof body.requested_at !== 'string'
  ) {
    throw new GraphApiError('Graph refresh receipt did not match the bounded API contract.', 202);
  }
  return {
    project_id: body.project_id,
    job_id: body.job_id,
    state: body.state,
    command_id: body.command_id,
    requested_at: body.requested_at,
  };
}

function abortError(): Error {
  const error = new Error('Graph refresh polling was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(abortError());
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, POLL_INTERVAL_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function pollGraphRefresh({
  projectId,
  receipt,
  signal,
  fetcher = fetch,
  wait = waitForNextPoll,
  onProgress,
}: PollRefreshOptions): Promise<GraphRefreshResult> {
  while (!signal.aborted) {
    let job: GraphJob;
    try {
      job = await fetchGraphJob(projectId, receipt.job_id, fetcher);
    } catch (error) {
      if (error instanceof GraphApiError && error.status === 404) {
        onProgress?.('queued', null);
        await wait(signal);
        continue;
      }
      throw error;
    }

    const receiptBelongsToJob =
      job.command_ids !== null
        ? job.command_ids.includes(receipt.command_id)
        : job.command_id === receipt.command_id;
    if (!receiptBelongsToJob) {
      throw new GraphApiError('Graphify returned a job for a different refresh command.', 409);
    }
    if (job.state === 'failed') {
      throw new GraphApiError('Graphify reported that the rebuild job failed.', 503);
    }
    if (job.state === 'queued') {
      onProgress?.('queued', job);
    } else if (job.state === 'running') {
      onProgress?.('building', job);
    } else {
      try {
        const snapshot = await fetchGraphSnapshot(projectId, fetcher);
        return { ...snapshot, job };
      } catch (error) {
        // A first release can become visible just after the supervisor marks
        // its exact job succeeded. Keep polling that job until the bounded
        // status/overview pair is readable; never fall back to raw graph data.
        if (!(error instanceof GraphApiError) || error.status !== 404) throw error;
        onProgress?.('building', job);
      }
    }

    await wait(signal);
  }

  throw abortError();
}
