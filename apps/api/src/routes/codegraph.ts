/**
 * Authenticated, bounded views over the internal Graphify supervisor.
 *
 * Project membership comes only from the operator-owned registry. Graph files
 * are accepted only through a `current` symlink resolving beneath that
 * project's immutable `releases` directory. Raw Graphify JSON is never sent to
 * a browser.
 */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { identifiersOf } from '../context.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';
import { ProblemError } from '../problem.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';

const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const SAFE_ID_PATTERN = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 256 * 1024;
const MAX_CONTROL_BYTES = 1024 * 1024;
const MAX_INPUT_NODES = 50_000;
const MAX_INPUT_EDGES = 200_000;
const MAX_ITEM_PROPERTIES = 64;
const MAX_NESTED_PROPERTIES = 256;
const MAX_ATTRIBUTE_DEPTH = 4;
const MAX_ATTRIBUTE_ARRAY = 256;
const MAX_ATTRIBUTE_STRING = 32_768;
const MAX_NODES = 100;
const MAX_EDGES = 200;
const READ_ATTEMPTS = 3;
const CONTROL_TIMEOUT_MS = 5_000;
const GRAPH_CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_GRAPH_CACHE_ENTRIES = 16;
const MAX_COLD_GRAPH_LOADS = 2;
const MAX_COLD_GRAPH_WAITERS = 32;
const DEFAULT_READ_LIMIT = 120;
const READ_WINDOW_MS = 60_000;
const REFRESH_LIMIT = 3;
const REFRESH_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 10_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_IDEMPOTENCY_RECORDS = 10_000;
const MAX_COMMAND_IDS_PER_JOB = 256;
const OVERLAY_ENTITY_TYPES = ['Project', 'Module', 'Skill', 'Tool'] as const;

const projectParamsSchema = z
  .object({ project: z.string().regex(PROJECT_ID_PATTERN) })
  .strict();
const nodeParamsSchema = projectParamsSchema
  .extend({ node: z.string().regex(SAFE_ID_PATTERN) })
  .strict();
const jobParamsSchema = projectParamsSchema
  .extend({ job: z.string().regex(/^[a-f0-9]{32}$/) })
  .strict();
const refreshBodySchema = z
  .object({ command_id: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/) })
  .strict();

const pipelineNodeSchema = z
  .object({
    id: z.string().regex(SAFE_ID_PATTERN),
    kind: z.enum(['image', 'text', 'data', 'process', 'gate', 'output']),
    title: z.string().min(1).max(160),
    subtitle: z.string().max(240).optional(),
    status: z.enum(['ok', 'warn', 'error', 'running', 'idle']).optional(),
  })
  .strict();
const pipelineEdgeSchema = z
  .object({
    id: z.string().regex(SAFE_ID_PATTERN),
    source: z.string().regex(SAFE_ID_PATTERN),
    target: z.string().regex(SAFE_ID_PATTERN),
    label: z.string().max(80).optional(),
    kind: z.enum(['data', 'control']).optional(),
  })
  .strict();
const pipelineSpecSchema = z
  .object({
    id: z.string().regex(SAFE_ID_PATTERN),
    title: z.string().min(1).max(160),
    description: z.string().max(240).optional(),
    direction: z.enum(['LR', 'TB']).optional(),
    nodes: z.array(pipelineNodeSchema).min(1).max(MAX_NODES),
    edges: z.array(pipelineEdgeSchema).max(MAX_EDGES),
  })
  .strict();

const projectSummarySchema = z
  .object({
    id: z.string().regex(PROJECT_ID_PATTERN),
    name: z.string().min(1).max(160),
    available: z.boolean(),
    generated_at: z.string().nullable(),
  })
  .strict();
const projectsResponseSchema = z
  .object({ projects: z.array(projectSummarySchema).max(100), identifiers: identifiersSchema })
  .strict();
const jobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
const jobSchema = z
  .object({
    job_id: z.string().regex(JOB_ID_PATTERN).max(128),
    state: jobStateSchema,
    requested_at: z.string().nullable(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    command_id: z.string().nullable(),
    command_ids: z
      .array(z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/))
      .min(1)
      .max(MAX_COMMAND_IDS_PER_JOB)
      .nullable(),
    release: z.string().nullable(),
    has_error: z.boolean(),
  })
  .strict();
const statusResponseSchema = z
  .object({
    project_id: z.string().regex(PROJECT_ID_PATTERN),
    state: z.enum(['ready', 'queued', 'building', 'degraded', 'unavailable']),
    generated_at: z.string().nullable(),
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    build: z
      .object({
        building: z.boolean(),
        queued: z.boolean(),
        initial_complete: z.boolean(),
        last_success_at: z.string().nullable(),
        has_error: z.boolean(),
        active_job: jobSchema.nullable(),
        recent_jobs: z.array(jobSchema).max(10),
      })
      .strict(),
    identifiers: identifiersSchema,
  })
  .strict();
const sliceResponseSchema = z
  .object({
    project_id: z.string().regex(PROJECT_ID_PATTERN),
    truncated: z.boolean(),
    total_nodes: z.number().int().nonnegative(),
    total_edges: z.number().int().nonnegative(),
    spec: pipelineSpecSchema,
    identifiers: identifiersSchema,
  })
  .strict();
const refreshResponseSchema = z
  .object({
    project_id: z.string().regex(PROJECT_ID_PATTERN),
    job_id: z.string().regex(JOB_ID_PATTERN).max(128),
    state: jobStateSchema,
    command_id: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
    requested_at: z.string(),
    identifiers: identifiersSchema,
  })
  .strict();
const jobResponseSchema = z
  .object({
    project_id: z.string().regex(PROJECT_ID_PATTERN),
    job: jobSchema,
    identifiers: identifiersSchema,
  })
  .strict();

const READERS = ['owner', 'operator', 'builder', 'service_identity'] as const;

export const codegraphProjectsRoute = defineRoute({
  operationId: 'codegraphProjects',
  method: 'GET',
  path: '/v1/codegraph/projects',
  group: '/v1/codegraph',
  summary: 'List registered code graph projects',
  description: 'Lists only projects from the operator-owned codegraph registry.',
  actorRoles: READERS,
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'eventually_consistent',
  errors: ['unauthenticated', 'forbidden', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: [],
  response: projectsResponseSchema,
  successStatus: 200,
});

export const codegraphStatusRoute = defineRoute({
  operationId: 'codegraphStatus',
  method: 'GET',
  path: '/v1/codegraph/:project/status',
  group: '/v1/codegraph',
  summary: 'Get live code graph status',
  description: 'Combines immutable release counts with authenticated live supervisor job state.',
  actorRoles: READERS,
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'eventually_consistent',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 240, burst: 40 },
  auditObligations: [],
  params: projectParamsSchema,
  response: statusResponseSchema,
  successStatus: 200,
});

export const codegraphOverviewRoute = defineRoute({
  operationId: 'codegraphOverview',
  method: 'GET',
  path: '/v1/codegraph/:project/overview',
  group: '/v1/codegraph',
  summary: 'Get bounded code graph overview',
  description: 'Returns at most 100 nodes and 200 edges, ranked by confidence and degree.',
  actorRoles: READERS,
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'eventually_consistent',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: [],
  params: projectParamsSchema,
  response: sliceResponseSchema,
  successStatus: 200,
});

export const codegraphSpecRoute = defineRoute({
  operationId: 'codegraphSpec',
  method: 'GET',
  path: '/v1/codegraph/:project/spec',
  group: '/v1/codegraph',
  summary: 'Get bounded code graph PipelineSpec',
  description: 'Backward-compatible PipelineSpec alias for the bounded overview.',
  actorRoles: READERS,
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'eventually_consistent',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: [],
  params: projectParamsSchema,
  response: pipelineSpecSchema,
  successStatus: 200,
});

export const codegraphExpandRoute = defineRoute({
  operationId: 'codegraphNodeExpand',
  method: 'GET',
  path: '/v1/codegraph/:project/nodes/:node/expand',
  group: '/v1/codegraph',
  summary: 'Expand a code graph node',
  description: 'Returns a bounded one-hop slice around an API-issued stable node identifier.',
  actorRoles: READERS,
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'eventually_consistent',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 240, burst: 40 },
  auditObligations: [],
  params: nodeParamsSchema,
  response: sliceResponseSchema,
  successStatus: 200,
});

export const codegraphRefreshRoute = defineRoute({
  operationId: 'codegraphRefresh',
  method: 'POST',
  path: '/v1/codegraph/:project/refresh',
  group: '/v1/codegraph',
  summary: 'Queue a code graph rebuild',
  description: 'Queues a rebuild through the supervisor\'s single-running/coalesced-queue control. Owner and operator only.',
  actorRoles: ['owner', 'operator', 'service_identity'],
  capability: 'codegraph.refresh',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'required_key',
  consistency: 'eventually_consistent',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: REFRESH_LIMIT, burst: REFRESH_LIMIT },
  auditObligations: ['refresh'],
  params: projectParamsSchema,
  body: refreshBodySchema,
  response: refreshResponseSchema,
  successStatus: 202,
});

export const codegraphJobRoute = defineRoute({
  operationId: 'codegraphJob',
  method: 'GET',
  path: '/v1/codegraph/:project/jobs/:job',
  group: '/v1/codegraph',
  summary: 'Poll a code graph rebuild job',
  description: 'Returns one authenticated supervisor job with bounded, snake-case fields.',
  actorRoles: READERS,
  capability: 'codegraph.read',
  dataClasses: ['internal'],
  standingPolicyEligible: false,
  policyOperation: null,
  idempotency: 'safe',
  consistency: 'eventually_consistent',
  errors: ['validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'rate_limited', 'service_unavailable', 'internal_error'],
  rateLimit: { requestsPerMinute: 240, burst: 40 },
  auditObligations: [],
  params: jobParamsSchema,
  response: jobResponseSchema,
  successStatus: 200,
});

export const codegraphRoutes = [
  codegraphProjectsRoute,
  codegraphStatusRoute,
  codegraphOverviewRoute,
  codegraphSpecRoute,
  codegraphExpandRoute,
  codegraphJobRoute,
  codegraphRefreshRoute,
];

export interface CodegraphRouteDependencies extends RouteHandlerDependencies {
  readonly codegraphOutputDir?: string;
  readonly codegraphRegistryFile?: string;
  readonly codegraphServiceUrl?: string;
  readonly codegraphControlTokenFile?: string;
  /** Test/operator override; production defaults to a bounded 120 reads/minute/principal. */
  readonly codegraphReadLimit?: number;
  readonly fetch?: typeof globalThis.fetch;
}

type ReadResult =
  | { kind: 'missing' | 'invalid' }
  | { kind: 'ok'; value: unknown };
type RegistryProject = { id: string; name: string };
type GraphNode = {
  rawId: string;
  title: string;
  kind: z.infer<typeof pipelineNodeSchema>['kind'];
  origin: 'graphify' | 'frank-overlay';
  entityType: string;
  confidence: number;
};
type GraphEdge = {
  rawKey: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
};
type NormalizedGraph = { nodes: GraphNode[]; edges: GraphEdge[]; generatedAt: string | null };
type GraphSlice = Omit<z.infer<typeof sliceResponseSchema>, 'identifiers'>;
type SupervisorJob = z.infer<typeof jobSchema>;
type SupervisorProject = {
  id: string;
  building: boolean;
  queued: boolean;
  initialComplete: boolean;
  lastSuccessAt: string | null;
  hasError: boolean;
  jobs: SupervisorJob[];
};
type RefreshResult = {
  job_id: string;
  state: SupervisorJob['state'];
  command_id: string;
  requested_at: string;
};
type RateBucket = { lastSeen: number; timestamps: number[] };
type GraphCacheRecord = { lastAccess: number; graph: NormalizedGraph };

function outputDir(deps: CodegraphRouteDependencies): string {
  return deps.codegraphOutputDir ?? process.env.CODEGRAPH_OUTPUT ?? '/data/codegraph';
}

function registryFile(deps: CodegraphRouteDependencies): string {
  return deps.codegraphRegistryFile ?? process.env.CODEGRAPH_REGISTRY ?? '/etc/frank-codegraph/projects.json';
}

function serviceUrl(deps: CodegraphRouteDependencies): string {
  return deps.codegraphServiceUrl ?? process.env.CODEGRAPH_STATUS_URL ?? 'http://frank-codegraph:3002';
}

function controlTokenFile(deps: CodegraphRouteDependencies): string {
  return deps.codegraphControlTokenFile ??
    process.env.CODEGRAPH_CONTROL_TOKEN_FILE ??
    '/run/secrets/frank_codegraph_control_token';
}

async function readBoundedJson(filePath: string, maximumBytes: number): Promise<ReadResult> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    try {
      const file = await stat(filePath);
      if (!file.isFile()) return { kind: 'missing' };
      if (file.size > maximumBytes) return { kind: 'invalid' };
      const raw = await readFile(filePath, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > maximumBytes) return { kind: 'invalid' };
      try {
        return { kind: 'ok', value: JSON.parse(raw) as unknown };
      } catch {
        if (attempt + 1 < READ_ATTEMPTS) continue;
        return { kind: 'invalid' };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && attempt + 1 < READ_ATTEMPTS) continue;
      return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
    }
  }
  return { kind: 'invalid' };
}

async function readReleaseJson(
  release: string,
  relativePath: readonly string[],
  maximumBytes: number,
): Promise<ReadResult> {
  try {
    const file = await realpath(join(release, ...relativePath));
    if (!pathIsWithin(file, release) || file === release) return { kind: 'invalid' };
    return await readBoundedJson(file, maximumBytes);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'invalid' };
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseRegistry(value: unknown): RegistryProject[] | null {
  const registry = objectOf(value);
  if (registry === null || registry.schema_version !== 1 || !Array.isArray(registry.projects)) {
    return null;
  }
  if (registry.projects.length === 0 || registry.projects.length > 100) return null;
  const seen = new Set<string>();
  const projects: RegistryProject[] = [];
  for (const entry of registry.projects) {
    const project = objectOf(entry);
    if (
      project === null ||
      typeof project.id !== 'string' ||
      !PROJECT_ID_PATTERN.test(project.id) ||
      typeof project.name !== 'string' ||
      project.name.length === 0 ||
      project.name.length > 160 ||
      seen.has(project.id)
    ) {
      return null;
    }
    seen.add(project.id);
    projects.push({ id: project.id, name: project.name });
  }
  return projects.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadRegistry(deps: CodegraphRouteDependencies): Promise<RegistryProject[]> {
  const result = await readBoundedJson(registryFile(deps), MAX_REGISTRY_BYTES);
  const projects = result.kind === 'ok' ? parseRegistry(result.value) : null;
  if (projects === null) {
    throw new ProblemError('service_unavailable', 'The code graph project registry is unavailable.');
  }
  return projects;
}

async function requireRegisteredProject(
  deps: CodegraphRouteDependencies,
  projectId: string,
): Promise<RegistryProject> {
  const project = (await loadRegistry(deps)).find((candidate) => candidate.id === projectId);
  if (project === undefined) {
    throw new ProblemError('not_found', 'No registered code graph project exists with that identifier.');
  }
  return project;
}

function pathIsWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function currentRelease(
  deps: CodegraphRouteDependencies,
  project: string,
): Promise<string | null> {
  try {
    const output = await realpath(resolve(outputDir(deps)));
    const projectRoot = await realpath(join(output, project));
    if (!pathIsWithin(projectRoot, output)) return null;
    const releases = await realpath(join(projectRoot, 'releases'));
    const current = await realpath(join(projectRoot, 'current'));
    if (!pathIsWithin(releases, projectRoot) || !pathIsWithin(current, releases) || current === releases) {
      throw new ProblemError('service_unavailable', 'The code graph release selector is invalid.');
    }
    return current;
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ProblemError('service_unavailable', 'The code graph release selector is unavailable.');
  }
}

function attributesAreBounded(record: Record<string, unknown>): boolean {
  if (Object.keys(record).length > MAX_ITEM_PROPERTIES) return false;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: record, depth: 0 }];
  let propertyCount = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (typeof current.value === 'string') {
      if (current.value.length > MAX_ATTRIBUTE_STRING) return false;
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_ATTRIBUTE_ARRAY || current.depth >= MAX_ATTRIBUTE_DEPTH) return false;
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    const nested = objectOf(current.value);
    if (nested === null) continue;
    const keys = Object.keys(nested);
    if (keys.some((key) => key.length > MAX_ATTRIBUTE_STRING)) return false;
    propertyCount += keys.length;
    if (propertyCount > MAX_NESTED_PROPERTIES || current.depth >= MAX_ATTRIBUTE_DEPTH) return false;
    for (const key of keys) stack.push({ value: nested[key], depth: current.depth + 1 });
  }
  return true;
}

function stringOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function boundedText(value: unknown, fallback: string, maximum = 160): string {
  const text = stringOf(value, fallback).replace(/[\r\n\t]+/g, ' ').trim();
  return (text || fallback).slice(0, maximum);
}

function confidenceOf(value: unknown): number {
  const text = stringOf(value).toLowerCase();
  if (text === 'extracted' || text === 'high') return 2;
  if (text === 'inferred' || text === 'medium') return 1;
  return 0;
}

function rawNodeId(node: Record<string, unknown>, index: number): string | null {
  const value = node.id ?? node.key ?? `node-${index}`;
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length > MAX_ATTRIBUTE_STRING) {
    return null;
  }
  return String(value);
}

function endpointId(
  value: unknown,
  nodes: readonly Record<string, unknown>[],
  known: ReadonlySet<string>,
): string | null {
  if ((typeof value === 'string' || typeof value === 'number') && known.has(String(value))) {
    return String(value);
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < nodes.length) {
    return rawNodeId(nodes[value] as Record<string, unknown>, value);
  }
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length > MAX_ATTRIBUTE_STRING) {
    return null;
  }
  return String(value);
}

function nodeKind(
  node: Record<string, unknown>,
  origin: GraphNode['origin'],
): z.infer<typeof pipelineNodeSchema>['kind'] {
  const type = `${stringOf(node.type)} ${stringOf(node.kind)} ${stringOf(node.label)}`.toLowerCase();
  if (origin === 'frank-overlay') {
    if (type.includes('project')) return 'output';
    if (type.includes('skill') || type.includes('tool')) return 'process';
  }
  if (type.includes('class') || type.includes('function') || type.includes('method')) return 'process';
  return 'data';
}

function entityTypeOf(node: Record<string, unknown>, origin: GraphNode['origin']): string {
  const explicit = boundedText(node.type ?? node.kind, origin === 'frank-overlay' ? 'Frank entity' : 'Symbol', 64);
  return explicit;
}

function normalizeGraph(graphJson: unknown, overlayJson: unknown): NormalizedGraph | null {
  const graph = objectOf(graphJson);
  if (graph === null || !Array.isArray(graph.nodes)) return null;
  const baseEdges = Array.isArray(graph.links)
    ? graph.links
    : Array.isArray(graph.edges)
      ? graph.edges
      : null;
  if (baseEdges === null) return null;
  const overlay = overlayJson === null ? null : objectOf(overlayJson);
  if (overlayJson !== null && overlay === null) return null;
  const overlayNodes = overlay === null || overlay.nodes === undefined ? [] : overlay.nodes;
  const overlayEdges =
    overlay === null
      ? []
      : Array.isArray(overlay.links)
        ? overlay.links
        : overlay.edges === undefined
          ? []
          : overlay.edges;
  if (!Array.isArray(overlayNodes) || !Array.isArray(overlayEdges)) return null;
  if (
    graph.nodes.length + overlayNodes.length > MAX_INPUT_NODES ||
    baseEdges.length + overlayEdges.length > MAX_INPUT_EDGES
  ) {
    return null;
  }

  const rawNodes = [
    ...graph.nodes.map((entry) => ({ entry, origin: 'graphify' as const })),
    ...overlayNodes.map((entry) => ({ entry, origin: 'frank-overlay' as const })),
  ];
  const nodeRecords: Array<{ record: Record<string, unknown>; origin: GraphNode['origin'] }> = [];
  for (const { entry, origin } of rawNodes) {
    const record = objectOf(entry);
    if (record === null || !attributesAreBounded(record)) return null;
    nodeRecords.push({ record, origin });
  }
  const rawNodeRecords = nodeRecords.map(({ record }) => record);
  const seenNodes = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const [index, { record: item, origin }] of nodeRecords.entries()) {
    const rawId = rawNodeId(item, index);
    if (rawId === null || rawId.length === 0 || seenNodes.has(rawId)) return null;
    seenNodes.add(rawId);
    nodes.push({
      rawId,
      title: boundedText(item.label ?? item.name ?? item.title, `Graph node ${index + 1}`),
      kind: nodeKind(item, origin),
      origin,
      entityType: entityTypeOf(item, origin),
      confidence: confidenceOf(item.confidence),
    });
  }

  const rawEdges = [...baseEdges, ...overlayEdges];
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const [index, entry] of rawEdges.entries()) {
    const item = objectOf(entry);
    if (item === null || !attributesAreBounded(item)) return null;
    const source = endpointId(item.source, rawNodeRecords, seenNodes);
    const target = endpointId(item.target, rawNodeRecords, seenNodes);
    if (source === null || target === null || !seenNodes.has(source) || !seenNodes.has(target)) return null;
    if (source === target) continue;
    const relation = boundedText(item.relation ?? item.type ?? item.label, 'relates to', 80);
    const explicitId = typeof item.id === 'string' && item.id.length <= MAX_ATTRIBUTE_STRING
      ? item.id
      : String(index);
    const rawKey = `${source}\u0000${target}\u0000${relation}\u0000${explicitId}`;
    if (seenEdges.has(rawKey)) return null;
    seenEdges.add(rawKey);
    edges.push({
      rawKey,
      source,
      target,
      relation,
      confidence: confidenceOf(item.confidence),
    });
  }
  const metadata = objectOf(graph.graph) ?? objectOf(graph.metadata) ?? graph;
  const generatedAt =
    typeof metadata.generated_at === 'string'
      ? metadata.generated_at.slice(0, MAX_ATTRIBUTE_STRING)
      : typeof metadata.generatedAt === 'string'
        ? metadata.generatedAt.slice(0, MAX_ATTRIBUTE_STRING)
        : null;
  return { nodes, edges, generatedAt };
}

function opaqueId(prefix: 'n' | 'e', raw: string): string {
  return `${prefix}.${createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32)}`;
}

function stableNodeIds(nodes: readonly GraphNode[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const base = opaqueId('n', node.rawId);
    const members = groups.get(base) ?? [];
    members.push(node.rawId);
    groups.set(base, members);
  }
  const result = new Map<string, string>();
  for (const [base, members] of groups) {
    members.sort();
    members.forEach((rawId, index) => result.set(rawId, index === 0 ? base : `${base}-${index + 1}`));
  }
  return result;
}

function makeSlice(project: string, graph: NormalizedGraph, focusRawId?: string): GraphSlice {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const ordered = [...graph.nodes].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      (degree.get(right.rawId) ?? 0) - (degree.get(left.rawId) ?? 0) ||
      left.rawId.localeCompare(right.rawId),
  );
  const selected = focusRawId === undefined
    ? (() => {
        const anchors: GraphNode[] = [];
        const anchored = new Set<string>();
        for (const entityType of OVERLAY_ENTITY_TYPES) {
          const match = ordered.find(
            (node) =>
              node.origin === 'frank-overlay' &&
              node.entityType.toLowerCase() === entityType.toLowerCase(),
          );
          if (match !== undefined) {
            anchors.push(match);
            anchored.add(match.rawId);
          }
        }
        const remainingOverlay = ordered.filter(
          (node) => node.origin === 'frank-overlay' && !anchored.has(node.rawId),
        );
        const graphify = ordered.filter((node) => node.origin === 'graphify');
        return [...anchors, ...remainingOverlay, ...graphify].slice(0, MAX_NODES);
      })()
    : (() => {
        const neighborIds = new Set<string>([focusRawId]);
        for (const edge of graph.edges) {
          if (edge.source === focusRawId || edge.target === focusRawId) {
            neighborIds.add(edge.source);
            neighborIds.add(edge.target);
            if (neighborIds.size >= MAX_NODES) break;
          }
        }
        return ordered.filter((node) => neighborIds.has(node.rawId)).slice(0, MAX_NODES);
      })();
  if (selected.length === 0) {
    throw new ProblemError('service_unavailable', 'The code graph is empty or invalid.');
  }
  const nodeIds = stableNodeIds(graph.nodes);
  const allowed = new Set(selected.map((node) => node.rawId));
  const eligibleEdges = graph.edges
    .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target) ||
        left.rawKey.localeCompare(right.rawKey),
    );
  const spec = {
    id: `codegraph.${project}`,
    title: `${project} code graph`,
    description: 'Bounded Graphify graph slice.',
    direction: 'LR' as const,
    nodes: selected.map((node) => ({
      id: nodeIds.get(node.rawId) as string,
      kind: node.kind,
      title: node.title,
      subtitle: `${node.origin === 'frank-overlay' ? 'Frank overlay' : 'Graphify'} | ${node.entityType} | ${degree.get(node.rawId) ?? 0} connections`,
      status: node.confidence >= 2 ? ('ok' as const) : ('idle' as const),
    })),
    edges: eligibleEdges.slice(0, MAX_EDGES).map((edge) => ({
      id: opaqueId('e', edge.rawKey),
      source: nodeIds.get(edge.source) as string,
      target: nodeIds.get(edge.target) as string,
      label: edge.relation,
      kind: edge.confidence >= 2 ? ('data' as const) : ('control' as const),
    })),
  };
  return {
    project_id: project,
    truncated: selected.length < graph.nodes.length || eligibleEdges.length > MAX_EDGES,
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    spec,
  };
}

async function loadReleaseGraph(release: string): Promise<NormalizedGraph> {
  const graphFile = await readReleaseJson(release, ['graphify-out', 'graph.json'], MAX_GRAPH_BYTES);
  if (graphFile.kind === 'missing') throw new ProblemError('not_found', 'No code graph exists for this project.');
  if (graphFile.kind === 'invalid') throw new ProblemError('service_unavailable', 'The code graph output is unavailable.');
  const overlayFile = await readReleaseJson(release, ['frank-overlay.json'], MAX_GRAPH_BYTES);
  if (overlayFile.kind === 'invalid') throw new ProblemError('service_unavailable', 'The code graph overlay is unavailable.');
  const normalized = normalizeGraph(graphFile.value, overlayFile.kind === 'ok' ? overlayFile.value : null);
  if (normalized === null) throw new ProblemError('service_unavailable', 'The code graph exceeds its safety limits or is invalid.');
  return normalized;
}

class ColdGraphLoadGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < MAX_COLD_GRAPH_LOADS) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= MAX_COLD_GRAPH_WAITERS) {
      throw new ProblemError('service_unavailable', 'Too many code graph releases are loading.');
    }
    // The active slot is transferred directly by release(), so a newly arriving
    // request cannot race a woken waiter and exceed MAX_COLD_GRAPH_LOADS.
    await new Promise<void>((resolveWaiter) => this.waiters.push(resolveWaiter));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    this.active -= 1;
  }
}

function pruneGraphCache(cache: Map<string, GraphCacheRecord>, now: number): void {
  for (const [release, record] of cache) {
    if (now - record.lastAccess > GRAPH_CACHE_TTL_MS) cache.delete(release);
  }
  while (cache.size > MAX_GRAPH_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function createGraphLoader(
  deps: CodegraphRouteDependencies,
): (project: string) => Promise<NormalizedGraph> {
  const cache = new Map<string, GraphCacheRecord>();
  const inFlight = new Map<string, Promise<NormalizedGraph>>();
  const gate = new ColdGraphLoadGate();

  return async (project: string): Promise<NormalizedGraph> => {
    await requireRegisteredProject(deps, project);
    const release = await currentRelease(deps, project);
    if (release === null) throw new ProblemError('not_found', 'No code graph release exists for this project.');
    const now = deps.now().getTime();
    pruneGraphCache(cache, now);
    const cached = cache.get(release);
    if (cached !== undefined) {
      cache.delete(release);
      cache.set(release, { ...cached, lastAccess: now });
      return cached.graph;
    }
    const existing = inFlight.get(release);
    if (existing !== undefined) return existing;

    const load = gate.run(async () => {
      const graph = await loadReleaseGraph(release);
      cache.set(release, { graph, lastAccess: deps.now().getTime() });
      pruneGraphCache(cache, deps.now().getTime());
      return graph;
    });
    inFlight.set(release, load);
    try {
      return await load;
    } finally {
      if (inFlight.get(release) === load) inFlight.delete(release);
    }
  };
}

async function loadControlToken(deps: CodegraphRouteDependencies): Promise<string> {
  try {
    const file = await stat(controlTokenFile(deps));
    if (!file.isFile() || file.size < 32 || file.size > 4_096) throw new Error('invalid secret');
    const token = (await readFile(controlTokenFile(deps), 'utf8')).trim();
    if (token.length < 32 || token.length > 4_096 || /\s/.test(token)) throw new Error('invalid secret');
    return token;
  } catch {
    throw new ProblemError('service_unavailable', 'The code graph control credential is unavailable.');
  }
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_CONTROL_BYTES) {
    throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid response.');
  }
  if (response.body === null) {
    throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid response.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > MAX_CONTROL_BYTES) {
        await reader.cancel();
        throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid response.');
      }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid response.');
  }
}

function parseJob(value: unknown): SupervisorJob | null {
  const job = objectOf(value);
  if (job === null) return null;
  const id = job.id ?? job.job_id ?? job.jobId;
  const state = job.state;
  if (
    typeof id !== 'string' ||
    id.length > 128 ||
    !JOB_ID_PATTERN.test(id) ||
    (state !== 'queued' && state !== 'running' && state !== 'succeeded' && state !== 'failed')
  ) {
    return null;
  }
  const requested = job.requested_at ?? job.requestedAt;
  const started = job.started_at ?? job.startedAt;
  const completed = job.completed_at ?? job.completedAt;
  const command = job.command_id ?? job.commandId;
  const commandIdsValue = job.command_ids ?? job.commandIds;
  if (
    typeof requested !== 'string' ||
    requested.length === 0 ||
    requested.length > 128 ||
    (started !== undefined && started !== null && typeof started !== 'string') ||
    (completed !== undefined && completed !== null && typeof completed !== 'string') ||
    (command !== undefined && command !== null && typeof command !== 'string') ||
    (commandIdsValue !== undefined && commandIdsValue !== null &&
      (!Array.isArray(commandIdsValue) ||
        commandIdsValue.length === 0 ||
        commandIdsValue.length > MAX_COMMAND_IDS_PER_JOB ||
        commandIdsValue.some(
          (candidate) => typeof candidate !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(candidate),
        ) ||
        new Set(commandIdsValue).size !== commandIdsValue.length)) ||
    (job.release !== undefined && job.release !== null && typeof job.release !== 'string') ||
    (job.error !== undefined && job.error !== null && typeof job.error !== 'string')
  ) {
    return null;
  }
  const requestedAt = requested;
  const startedAt = typeof started === 'string' ? started.slice(0, 128) : null;
  const completedAt = typeof completed === 'string' ? completed.slice(0, 128) : null;
  const commandId = typeof command === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(command)
    ? command
    : null;
  const commandIds = Array.isArray(commandIdsValue) ? [...commandIdsValue] as string[] : null;
  if (commandIds !== null && commandId !== null && !commandIds.includes(commandId)) return null;
  const release = typeof job.release === 'string' ? job.release.slice(0, 128) : null;
  return {
    job_id: id,
    state,
    requested_at: requestedAt,
    started_at: startedAt,
    completed_at: completedAt,
    command_id: commandId,
    command_ids: commandIds,
    release,
    has_error: typeof job.error === 'string' && job.error.length > 0,
  };
}

function parseSupervisorProjects(value: unknown): SupervisorProject[] | null {
  const status = objectOf(value);
  if (status === null || status.schema_version !== 1 || !Array.isArray(status.projects) || status.projects.length > 100) {
    return null;
  }
  const projects: SupervisorProject[] = [];
  for (const entry of status.projects) {
    const project = objectOf(entry);
    if (
      project === null ||
      typeof project.id !== 'string' ||
      !PROJECT_ID_PATTERN.test(project.id) ||
      typeof project.building !== 'boolean' ||
      typeof project.queued !== 'boolean' ||
      typeof project.initial_complete !== 'boolean' ||
      !Array.isArray(project.jobs) ||
      project.jobs.length > 10 ||
      (project.last_success_at !== null &&
        project.last_success_at !== undefined &&
        typeof project.last_success_at !== 'string') ||
      (project.last_error !== null &&
        project.last_error !== undefined &&
        typeof project.last_error !== 'string')
    ) {
      return null;
    }
    const jobs = project.jobs.map(parseJob);
    if (jobs.some((job) => job === null)) return null;
    projects.push({
      id: project.id,
      building: project.building,
      queued: project.queued,
      initialComplete: project.initial_complete,
      lastSuccessAt: typeof project.last_success_at === 'string' ? project.last_success_at.slice(0, 128) : null,
      hasError: typeof project.last_error === 'string' && project.last_error.length > 0,
      jobs: jobs as SupervisorJob[],
    });
  }
  return projects;
}

async function supervisorRequest(
  deps: CodegraphRouteDependencies,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return await (deps.fetch ?? globalThis.fetch)(`${serviceUrl(deps).replace(/\/$/, '')}${path}`, {
      ...init,
      // Node's timeout signal remains active while the response body is read;
      // clearing a header-only timer here would permit an infinite slow body.
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      headers,
    });
  } catch {
    throw new ProblemError('service_unavailable', 'The code graph supervisor is unavailable.');
  }
}

async function supervisorProjects(
  deps: CodegraphRouteDependencies,
  token: string,
): Promise<SupervisorProject[]> {
  const response = await supervisorRequest(deps, token, '/status');
  if (response.status !== 200) {
    throw new ProblemError('service_unavailable', 'The code graph supervisor status is unavailable.');
  }
  const projects = parseSupervisorProjects(await boundedResponseJson(response));
  if (projects === null) {
    throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid status.');
  }
  return projects;
}

function parseRefresh(value: unknown, expectedCommandId: string): RefreshResult | null {
  const result = objectOf(value);
  if (result === null) return null;
  const jobId = result.job_id ?? result.jobId;
  const commandId = result.command_id ?? result.commandId;
  const requestedAt = result.requested_at ?? result.requestedAt;
  if (
    typeof jobId !== 'string' ||
    jobId.length > 128 ||
    !JOB_ID_PATTERN.test(jobId) ||
    (result.state !== 'queued' &&
      result.state !== 'running' &&
      result.state !== 'succeeded' &&
      result.state !== 'failed') ||
    commandId !== expectedCommandId ||
    typeof requestedAt !== 'string' ||
    requestedAt.length === 0 ||
    requestedAt.length > 128
  ) {
    return null;
  }
  return {
    job_id: jobId,
    state: result.state,
    command_id: commandId,
    requested_at: requestedAt,
  };
}

function parseJobResponse(
  value: unknown,
  expectedProject: string,
  expectedJob: string,
): SupervisorJob | null {
  const response = objectOf(value);
  const projectId = response?.project_id ?? response?.projectId;
  if (response === null || projectId !== expectedProject) return null;
  const job = parseJob(response.job);
  return job?.job_id === expectedJob ? job : null;
}

async function releaseSummary(
  deps: CodegraphRouteDependencies,
  project: string,
): Promise<{ generatedAt: string | null; nodes: number; edges: number } | null> {
  const release = await currentRelease(deps, project);
  if (release === null) return null;
  const statusFile = await readReleaseJson(release, ['status.json'], MAX_REGISTRY_BYTES);
  if (statusFile.kind !== 'ok') {
    throw new ProblemError('service_unavailable', 'The current code graph release status is unavailable.');
  }
  const status = objectOf(statusFile.value);
  const graphify = objectOf(status?.graphify);
  const overlay = status?.overlay === undefined ? { nodes: 0, edges: 0 } : objectOf(status.overlay);
  if (
    status === null ||
    graphify === null ||
    overlay === null ||
    typeof graphify.nodes !== 'number' ||
    !Number.isSafeInteger(graphify.nodes) ||
    graphify.nodes < 0 ||
    typeof graphify.edges !== 'number' ||
    !Number.isSafeInteger(graphify.edges) ||
    graphify.edges < 0 ||
    typeof overlay.nodes !== 'number' ||
    !Number.isSafeInteger(overlay.nodes) ||
    overlay.nodes < 0 ||
    typeof overlay.edges !== 'number' ||
    !Number.isSafeInteger(overlay.edges) ||
    overlay.edges < 0 ||
    graphify.nodes + overlay.nodes > MAX_INPUT_NODES ||
    graphify.edges + overlay.edges > MAX_INPUT_EDGES
  ) {
    throw new ProblemError('service_unavailable', 'The current code graph release status is invalid.');
  }
  return {
    generatedAt: typeof status.generated_at === 'string' ? status.generated_at.slice(0, 128) : null,
    nodes: graphify.nodes + overlay.nodes,
    edges: graphify.edges + overlay.edges,
  };
}

function publicJob(job: SupervisorJob): SupervisorJob {
  return { ...job };
}

function rateLimit(
  buckets: Map<string, RateBucket>,
  key: string,
  now: number,
  limit: number,
  windowMs: number,
  reply: FastifyReply,
  detail: string,
): void {
  const cutoff = now - windowMs;
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.lastSeen <= cutoff) buckets.delete(bucketKey);
  }
  let current = buckets.get(key)?.timestamps.filter((timestamp) => timestamp > cutoff) ?? [];
  if (current.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current[0] as number + windowMs - now) / 1_000));
    buckets.delete(key);
    buckets.set(key, { timestamps: current, lastSeen: now });
    void reply.header('retry-after', String(retryAfter));
    throw new ProblemError('rate_limited', detail);
  }
  current.push(now);
  if (!buckets.has(key)) {
    while (buckets.size >= MAX_RATE_BUCKETS) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  } else {
    buckets.delete(key);
  }
  buckets.set(key, { timestamps: current, lastSeen: now });
}

function pruneIdempotency(
  records: Map<string, { createdAt: number; result: Promise<RefreshResult> }>,
  now: number,
): void {
  for (const [key, record] of records) {
    if (now - record.createdAt > IDEMPOTENCY_TTL_MS) records.delete(key);
  }
  while (records.size >= MAX_IDEMPOTENCY_RECORDS) {
    const oldest = records.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
}

export function registerCodegraphRoutes(
  app: FastifyInstance,
  dependencies: CodegraphRouteDependencies,
): void {
  let tokenPromise: Promise<string> | undefined;
  const controlToken = (): Promise<string> => {
    tokenPromise ??= loadControlToken(dependencies);
    return tokenPromise;
  };
  const loadGraph = createGraphLoader(dependencies);
  const readBuckets = new Map<string, RateBucket>();
  const refreshBuckets = new Map<string, RateBucket>();
  const idempotency = new Map<string, { createdAt: number; result: Promise<RefreshResult> }>();
  const configuredReadLimit = dependencies.codegraphReadLimit ?? DEFAULT_READ_LIMIT;
  const readLimit = Number.isSafeInteger(configuredReadLimit) && configuredReadLimit > 0
    ? configuredReadLimit
    : DEFAULT_READ_LIMIT;
  const rateLimitRead = (
    cellId: string,
    principalId: string,
    reply: FastifyReply,
  ): void => rateLimit(
    readBuckets,
    `${cellId}\u0000${principalId}`,
    dependencies.now().getTime(),
    readLimit,
    READ_WINDOW_MS,
    reply,
    'Too many code graph read requests. Retry after the advertised interval.',
  );

  registerRoute(app, dependencies, codegraphProjectsRoute, async ({ context, principal, reply }) => {
    rateLimitRead(context.cellId, principal.principalId, reply);
    const registry = await loadRegistry(dependencies);
    const projects = await Promise.all(
      registry.map(async (project) => {
        const summary = await releaseSummary(dependencies, project.id);
        return {
          id: project.id,
          name: project.name,
          available: summary !== null,
          generated_at: summary?.generatedAt ?? null,
        };
      }),
    );
    return { projects, identifiers: identifiersOf(context) };
  });

  registerRoute(app, dependencies, codegraphStatusRoute, async ({ params, context, principal, reply }) => {
    rateLimitRead(context.cellId, principal.principalId, reply);
    await requireRegisteredProject(dependencies, params.project);
    const liveProject = (await supervisorProjects(dependencies, await controlToken()))
      .find((project) => project.id === params.project);
    if (liveProject === undefined) {
      throw new ProblemError('service_unavailable', 'The registered project is absent from the code graph supervisor.');
    }
    const summary = await releaseSummary(dependencies, params.project);
    const active = liveProject.jobs
      .filter((job) => job.state === 'running' || job.state === 'queued')
      .sort((left, right) => (left.state === 'running' ? -1 : right.state === 'running' ? 1 : 0))[0] ?? null;
    const state = liveProject.hasError
      ? 'degraded'
      : liveProject.building
        ? 'building'
        : liveProject.queued
          ? 'queued'
          : liveProject.initialComplete && summary !== null
            ? 'ready'
            : 'unavailable';
    return {
      project_id: params.project,
      state,
      generated_at: summary?.generatedAt ?? null,
      node_count: summary?.nodes ?? 0,
      edge_count: summary?.edges ?? 0,
      build: {
        building: liveProject.building,
        queued: liveProject.queued,
        initial_complete: liveProject.initialComplete,
        last_success_at: liveProject.lastSuccessAt,
        has_error: liveProject.hasError,
        active_job: active === null ? null : publicJob(active),
        recent_jobs: liveProject.jobs.map(publicJob),
      },
      identifiers: identifiersOf(context),
    };
  });

  const overview = async (project: string): Promise<GraphSlice> =>
    makeSlice(project, await loadGraph(project));
  registerRoute(app, dependencies, codegraphOverviewRoute, async ({ params, context, principal, reply }) => {
    rateLimitRead(context.cellId, principal.principalId, reply);
    return { ...(await overview(params.project)), identifiers: identifiersOf(context) };
  });
  registerRoute(app, dependencies, codegraphSpecRoute, async ({ params, context, principal, reply }) => {
    rateLimitRead(context.cellId, principal.principalId, reply);
    return (await overview(params.project)).spec;
  });
  registerRoute(app, dependencies, codegraphExpandRoute, async ({ params, context, principal, reply }) => {
    rateLimitRead(context.cellId, principal.principalId, reply);
    const graph = await loadGraph(params.project);
    const nodeIds = stableNodeIds(graph.nodes);
    const focused = [...nodeIds.entries()].find(([, safe]) => safe === params.node)?.[0];
    if (focused === undefined) {
      throw new ProblemError('not_found', 'No code graph node exists with that identifier.');
    }
    return { ...makeSlice(params.project, graph, focused), identifiers: identifiersOf(context) };
  });

  registerRoute(app, dependencies, codegraphJobRoute, async ({ params, context, principal, reply }) => {
    rateLimitRead(context.cellId, principal.principalId, reply);
    await requireRegisteredProject(dependencies, params.project);
    const response = await supervisorRequest(
      dependencies,
      await controlToken(),
      `/projects/${encodeURIComponent(params.project)}/jobs/${params.job}`,
    );
    if (response.status === 404) {
      throw new ProblemError('not_found', 'No code graph rebuild job exists with that identifier.');
    }
    if (response.status !== 200) {
      throw new ProblemError('service_unavailable', 'The code graph rebuild job is unavailable.');
    }
    const job = parseJobResponse(await boundedResponseJson(response), params.project, params.job);
    if (job === null) {
      throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid rebuild job.');
    }
    return { project_id: params.project, job, identifiers: identifiersOf(context) };
  });

  registerRoute(
    app,
    dependencies,
    codegraphRefreshRoute,
    async ({ params, body, context, principal, reply }) => {
      await requireRegisteredProject(dependencies, params.project);
      const now = dependencies.now().getTime();
      const idempotencyKey = `${context.cellId}\u0000${principal.principalId}\u0000${params.project}\u0000${body.command_id}`;
      pruneIdempotency(idempotency, now);
      const existing = idempotency.get(idempotencyKey);
      if (existing !== undefined && now - existing.createdAt <= IDEMPOTENCY_TTL_MS) {
        idempotency.delete(idempotencyKey);
        idempotency.set(idempotencyKey, existing);
        return {
          project_id: params.project,
          ...(await existing.result),
          identifiers: identifiersOf(context),
        };
      }
      rateLimit(
        refreshBuckets,
        `${context.cellId}\u0000${principal.principalId}\u0000${params.project}`,
        now,
        REFRESH_LIMIT,
        REFRESH_WINDOW_MS,
        reply,
        'Too many code graph refresh requests. Retry after the advertised interval.',
      );
      const request = (async (): Promise<RefreshResult> => {
        const token = await controlToken();
        const response = await supervisorRequest(
          dependencies,
          token,
          `/projects/${encodeURIComponent(params.project)}/refresh`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command_id: body.command_id }),
          },
        );
        if (response.status === 404) {
          throw new ProblemError('not_found', 'The code graph supervisor does not know this project.');
        }
        if (response.status !== 202) {
          throw new ProblemError('service_unavailable', 'The code graph supervisor could not queue a refresh.');
        }
        const accepted = parseRefresh(await boundedResponseJson(response), body.command_id);
        if (accepted === null) {
          throw new ProblemError('service_unavailable', 'The code graph supervisor returned an invalid refresh job.');
        }
        return accepted;
      })();
      idempotency.set(idempotencyKey, { createdAt: now, result: request });
      try {
        return {
          project_id: params.project,
          ...(await request),
          identifiers: identifiersOf(context),
        };
      } catch (error) {
        idempotency.delete(idempotencyKey);
        throw error;
      }
    },
  );
}
