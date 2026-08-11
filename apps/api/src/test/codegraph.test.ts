/** Security and contract tests for the bounded Graphify adapter. */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mintServiceToken } from '../../../../scripts/production/mint-service-token.js';
import { buildTestServer } from './harness.js';
import type { TestServer } from './harness.js';
import { TEST_NOW } from './harness.js';

const CONTROL_TOKEN = 'codegraph-control-token-32-bytes!';
const SAFE_ID = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const RUNNING_JOB = '11111111111111111111111111111111';
const NEW_JOB = '22222222222222222222222222222222';

type Fixture = {
  root: string;
  registry: string;
  token: string;
  projectRoot: string;
  release: string;
};

let server: TestServer | undefined;
let fixtureRoot: string | undefined;

afterEach(async () => {
  if (server !== undefined) await server.close();
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true });
  server = undefined;
  fixtureRoot = undefined;
});

const graphWithLinks = {
  graph: { generated_at: '2026-08-11T00:00:00.000Z' },
  nodes: [
    { id: 'src/foo.ts#run', label: 'run', type: 'function', confidence: 'EXTRACTED' },
    { id: 'src/bar.ts#helper', label: 'helper', type: 'function', confidence: 'INFERRED' },
  ],
  links: [
    {
      source: 'src/foo.ts#run',
      target: 'src/bar.ts#helper',
      relation: 'calls',
      confidence: 'EXTRACTED',
    },
  ],
};

function graphCounts(graph: Record<string, unknown>): { nodes: number; edges: number } {
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
    edges: Array.isArray(graph.links)
      ? graph.links.length
      : Array.isArray(graph.edges)
        ? graph.edges.length
        : 0,
  };
}

async function fixture(
  project: string,
  graph: Record<string, unknown> = graphWithLinks,
  overlay?: unknown,
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'frank-codegraph-'));
  fixtureRoot = root;
  const projectRoot = join(root, project);
  const release = join(projectRoot, 'releases', 'release-1');
  await mkdir(join(release, 'graphify-out'), { recursive: true });
  await writeFile(join(release, 'graphify-out', 'graph.json'), JSON.stringify(graph));
  if (overlay !== undefined) {
    await writeFile(join(release, 'frank-overlay.json'), JSON.stringify(overlay));
  }
  const counts = graphCounts(graph);
  await writeFile(
    join(release, 'status.json'),
    JSON.stringify({
      schema_version: 1,
      state: 'ready',
      project,
      generated_at: '2026-08-11T00:00:00.000Z',
      graphify: counts,
    }),
  );
  await symlink(join('releases', 'release-1'), join(projectRoot, 'current'), 'dir');
  const registry = join(root, 'projects.json');
  await writeFile(
    registry,
    JSON.stringify({ schema_version: 1, projects: [{ id: project, name: 'Frank Monorepo' }] }),
  );
  const token = join(root, 'control-token');
  await writeFile(token, CONTROL_TOKEN);
  return { root, registry, token, projectRoot, release };
}

function supervisorStatus(
  jobs: Array<Record<string, unknown>> = [],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: '2026-08-11T00:01:00.000Z',
    projects: [
      {
        id: 'frank',
        building: false,
        queued: false,
        initial_complete: true,
        last_success_at: '2026-08-11T00:00:00.000Z',
        last_error: null,
        jobs,
        ...overrides,
      },
    ],
  };
}

function start(
  target: Fixture,
  fetch?: typeof globalThis.fetch,
  codegraphReadLimit?: number,
): TestServer {
  server = buildTestServer({
    codegraph: {
      codegraphOutputDir: target.root,
      codegraphRegistryFile: target.registry,
      codegraphControlTokenFile: target.token,
      ...(codegraphReadLimit === undefined ? {} : { codegraphReadLimit }),
      ...(fetch === undefined ? {} : { fetch }),
    },
  });
  return server;
}

function validateSpec(value: Record<string, unknown>): boolean {
  const nodes = value.nodes as Array<Record<string, unknown>>;
  const edges = value.edges as Array<Record<string, unknown>>;
  if (
    !SAFE_ID.test(String(value.id)) ||
    !Array.isArray(nodes) ||
    nodes.length === 0 ||
    nodes.length > 100 ||
    !Array.isArray(edges) ||
    edges.length > 200
  ) {
    return false;
  }
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!SAFE_ID.test(String(node.id)) || nodeIds.has(String(node.id))) return false;
    nodeIds.add(String(node.id));
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!SAFE_ID.test(String(edge.id)) || edgeIds.has(String(edge.id))) return false;
    edgeIds.add(String(edge.id));
    if (!nodeIds.has(String(edge.source)) || !nodeIds.has(String(edge.target))) return false;
    if (edge.source === edge.target) return false;
  }
  return true;
}

describe('codegraph API security boundary', () => {
  it('lists only registry projects and requires a reader or explicitly scoped service', async () => {
    const files = await fixture('frank');
    await mkdir(join(files.root, 'unregistered', 'current'), { recursive: true });
    const target = start(files);

    expect((await target.app.inject({ method: 'GET', url: '/v1/codegraph/projects' })).statusCode)
      .toBe(401);
    for (const role of ['member', 'reviewer'] as const) {
      const denied = await target.app.inject({
        method: 'GET',
        url: '/v1/codegraph/projects',
        headers: { authorization: target.auth([role]) },
      });
      expect(denied.statusCode).toBe(403);
    }
    const unscoped = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/projects',
      headers: { authorization: target.auth(['service_identity']) },
    });
    expect(unscoped.statusCode).toBe(403);
    const unscopedRefresh = await target.app.inject({
      method: 'POST',
      url: '/v1/codegraph/frank/refresh',
      headers: { authorization: target.auth(['service_identity']) },
      payload: { command_id: 'cmd-unscoped-0001' },
    });
    expect(unscopedRefresh.statusCode).toBe(403);
    const scopedToken = target.token(['service_identity'], { capabilities: ['codegraph.read'] });
    const scoped = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/projects',
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(scoped.statusCode).toBe(200);
    expect((await target.app.inject({
      method: 'POST',
      url: '/v1/codegraph/frank/refresh',
      headers: { authorization: `Bearer ${scopedToken}` },
      payload: { command_id: 'cmd-read-only-0001' },
    })).statusCode).toBe(403);
    expect((scoped.json() as { projects: unknown[] }).projects).toEqual([
      {
        id: 'frank',
        name: 'Frank Monorepo',
        available: true,
        generated_at: '2026-08-11T00:00:00.000Z',
      },
    ]);
    expect(
      (await target.app.inject({
        method: 'GET',
        url: '/v1/codegraph/unregistered/spec',
        headers: { authorization: target.auth(['owner']) },
      })).statusCode,
    ).toBe(404);
    const traversal = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/..%2fsecret/spec',
      headers: { authorization: target.auth(['owner']) },
    });
    expect([400, 404]).toContain(traversal.statusCode);
  });

  it('emits stable SHA-256 IDs across spec, overview, and expansion', async () => {
    const files = await fixture('frank', graphWithLinks, {
      nodes: [{ id: 'skill:deploy', label: 'Deploy skill', type: 'skill' }],
      edges: [
        {
          source: 'skill:deploy',
          target: 'src/foo.ts#run',
          relation: 'uses tool',
          confidence: 'EXTRACTED',
        },
      ],
    });
    const target = start(files);
    const auth = { authorization: target.auth(['builder']) };
    const specResponse = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/spec',
      headers: auth,
    });
    expect(specResponse.statusCode).toBe(200);
    const spec = specResponse.json() as Record<string, unknown>;
    expect(validateSpec(spec)).toBe(true);
    const firstNode = (spec.nodes as Array<{ id: string }>)[0] as { id: string };
    expect(firstNode.id).toMatch(/^n\.[0-9a-f]{32}$/);
    expect(JSON.stringify(spec)).not.toContain('src/foo.ts#run');

    const overview = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/overview',
      headers: auth,
    });
    const overviewSpec = (overview.json() as { spec: Record<string, unknown> }).spec;
    expect((overviewSpec.nodes as Array<{ id: string }>).map((node) => node.id))
      .toEqual((spec.nodes as Array<{ id: string }>).map((node) => node.id));
    const expanded = await target.app.inject({
      method: 'GET',
      url: `/v1/codegraph/frank/nodes/${firstNode.id}/expand`,
      headers: auth,
    });
    expect(expanded.statusCode).toBe(200);
    expect(JSON.stringify(expanded.json())).toContain(firstNode.id);
    expect(
      (await target.app.inject({
        method: 'GET',
        url: '/v1/codegraph/frank/graph',
        headers: auth,
      })).statusCode,
    ).toBe(404);
  });

  it('authenticates supervisor status and reports live build/job state', async () => {
    const files = await fixture('frank');
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), authorization: headers.get('authorization') });
      if (String(input).includes('/jobs/')) {
        return Response.json({
          projectId: 'frank',
          job: {
            jobId: RUNNING_JOB,
            state: 'running',
            requestedAt: '2026-08-11T00:00:30.000Z',
            startedAt: '2026-08-11T00:00:31.000Z',
            commandIds: ['cmd-coalesced-0001', 'cmd-coalesced-0002'],
          },
        });
      }
      return Response.json(
        supervisorStatus(
          [
            {
              id: RUNNING_JOB,
              state: 'running',
              requested_at: '2026-08-11T00:00:30.000Z',
              started_at: '2026-08-11T00:00:31.000Z',
            },
          ],
          { building: true },
        ),
      );
    };
    const target = start(files, fetch as typeof globalThis.fetch);
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/status',
      headers: { authorization: target.auth(['operator']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.state).toBe('building');
    expect((body.build as { active_job: { job_id: string; state: string } }).active_job)
      .toMatchObject({ job_id: RUNNING_JOB, state: 'running' });
    const job = await target.app.inject({
      method: 'GET',
      url: `/v1/codegraph/frank/jobs/${RUNNING_JOB}`,
      headers: { authorization: target.auth(['operator']) },
    });
    expect(job.statusCode).toBe(200);
    expect(job.json()).toMatchObject({
      project_id: 'frank',
      job: {
        job_id: RUNNING_JOB,
        command_id: null,
        command_ids: ['cmd-coalesced-0001', 'cmd-coalesced-0002'],
        state: 'running',
      },
    });
    expect(calls.map((call) => call.url)).toEqual([
      'http://frank-codegraph:3002/status',
      `http://frank-codegraph:3002/projects/frank/jobs/${RUNNING_JOB}`,
    ]);
    expect(calls.every((call) => call.authorization === `Bearer ${CONTROL_TOKEN}`)).toBe(true);
  });

  it('rejects corrupt and oversized supervisor responses', async () => {
    const files = await fixture('frank');
    const fetch = async (input: string | URL | Request): Promise<Response> =>
      String(input).includes('/jobs/')
        ? new Response('x'.repeat(1024 * 1024 + 1), { status: 200 })
        : new Response('{not json', { status: 200 });
    const target = start(files, fetch as typeof globalThis.fetch);
    const headers = { authorization: target.auth(['operator']) };
    expect(
      (await target.app.inject({
        method: 'GET',
        url: '/v1/codegraph/frank/status',
        headers,
      })).statusCode,
    ).toBe(503);
    expect(
      (await target.app.inject({
        method: 'GET',
        url: `/v1/codegraph/frank/jobs/${RUNNING_JOB}`,
        headers,
      })).statusCode,
    ).toBe(503);
  });

  it('rejects unbounded coalesced command membership from the supervisor', async () => {
    const files = await fixture('frank');
    const fetch = async (): Promise<Response> => Response.json({
      projectId: 'frank',
      job: {
        jobId: RUNNING_JOB,
        state: 'queued',
        requestedAt: '2026-08-11T00:00:30.000Z',
        commandIds: Array.from({ length: 257 }, (_, index) => `cmd-coalesced-${index}`),
      },
    });
    const target = start(files, fetch as typeof globalThis.fetch);
    const response = await target.app.inject({
      method: 'GET',
      url: `/v1/codegraph/frank/jobs/${RUNNING_JOB}`,
      headers: { authorization: target.auth(['operator']) },
    });
    expect(response.statusCode).toBe(503);
  });

  it('forwards command_id and idempotently returns one validated refresh job', async () => {
    const files = await fixture('frank');
    const calls: Array<{ method: string; body: string | null; authorization: string | null }> = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      calls.push({
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
        authorization: headers.get('authorization'),
      });
      return init?.method === 'POST'
        ? Response.json(
            {
              jobId: NEW_JOB,
              state: 'queued',
              commandId: 'cmd-refresh-0001',
              requestedAt: '2026-08-11T00:02:00.000Z',
            },
            { status: 202 },
          )
        : Response.json(supervisorStatus());
    };
    const target = start(files, fetch as typeof globalThis.fetch);
    const request = {
      method: 'POST' as const,
      url: '/v1/codegraph/frank/refresh',
      headers: { authorization: target.auth(['owner']) },
      payload: { command_id: 'cmd-refresh-0001' },
    };
    const first = await target.app.inject(request);
    const replay = await target.app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      project_id: 'frank',
      job_id: NEW_JOB,
      state: 'queued',
      command_id: 'cmd-refresh-0001',
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      body: JSON.stringify({ command_id: 'cmd-refresh-0001' }),
      authorization: `Bearer ${CONTROL_TOKEN}`,
    });
  });

  it('honors supervisor queue coalescing and rate-limits commands per principal/project', async () => {
    const files = await fixture('frank');
    let posts = 0;
    const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'POST') {
        posts += 1;
        const commandId = (JSON.parse(String(init.body)) as { command_id: string }).command_id;
        return Response.json(
          {
            jobId: NEW_JOB,
            state: 'queued',
            commandId,
            requestedAt: '2026-08-11T00:02:00.000Z',
          },
          { status: 202 },
        );
      }
      return Response.json(supervisorStatus());
    };
    const target = start(files, fetch as typeof globalThis.fetch);
    const authorization = target.auth(['operator']);
    for (const command_id of ['cmd-rate-0001', 'cmd-rate-0002', 'cmd-rate-0003']) {
      expect(
        (await target.app.inject({
          method: 'POST',
          url: '/v1/codegraph/frank/refresh',
          headers: { authorization },
          payload: { command_id },
        })).statusCode,
      ).toBe(202);
    }
    const limited = await target.app.inject({
      method: 'POST',
      url: '/v1/codegraph/frank/refresh',
      headers: { authorization },
      payload: { command_id: 'cmd-rate-0004' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(posts).toBe(3);
  });

  it('caps the rendered slice even when accepted input is much larger', async () => {
    const nodes = Array.from({ length: 120 }, (_, index) => ({
      id: `node-${index}`,
      label: `Node ${index}`,
      type: 'function',
      confidence: 'EXTRACTED',
    }));
    const links = Array.from({ length: 300 }, (_, index) => ({
      id: `edge-${index}`,
      source: `node-${index % 100}`,
      target: `node-${(index + 1) % 100}`,
      relation: 'calls',
      confidence: 'EXTRACTED',
    }));
    const files = await fixture('frank', { nodes, links });
    const target = start(files);
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/overview',
      headers: { authorization: target.auth(['builder']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { truncated: boolean; spec: Record<string, unknown> };
    expect(body.truncated).toBe(true);
    expect((body.spec.nodes as unknown[]).length).toBe(100);
    expect((body.spec.edges as unknown[]).length).toBe(200);
    expect(validateSpec(body.spec)).toBe(true);
  });

  it('reserves overview capacity for Project, Module, Skill, and Tool overlay entities', async () => {
    const nodes = Array.from({ length: 120 }, (_, index) => ({
      id: `symbol-${index}`,
      label: `Symbol ${index}`,
      type: 'function',
      confidence: 'EXTRACTED',
    }));
    const overlayNodes = [
      { id: 'project:frank', name: 'Frank project', type: 'Project' },
      { id: 'module:frank:api', name: 'API module', type: 'Module' },
      { id: 'skill:frank:graphify', name: 'Graphify skill', type: 'Skill' },
      { id: 'tool:frank:codegraph', name: 'Codegraph tool', type: 'Tool' },
    ];
    const files = await fixture(
      'frank',
      { nodes, links: [] },
      { nodes: overlayNodes, edges: [] },
    );
    const target = start(files);
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/overview',
      headers: { authorization: target.auth(['builder']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { spec: { nodes: Array<Record<string, unknown>> } };
    expect(body.spec.nodes).toHaveLength(100);
    for (const [title, type, kind] of [
      ['Frank project', 'Project', 'output'],
      ['API module', 'Module', 'data'],
      ['Graphify skill', 'Skill', 'process'],
      ['Codegraph tool', 'Tool', 'process'],
    ] as const) {
      expect(body.spec.nodes).toContainEqual(
        expect.objectContaining({
          title,
          kind,
          subtitle: expect.stringContaining(`Frank overlay | ${type} |`),
        }),
      );
    }
  });

  it('caches normalized graphs by immutable release and reloads only after current changes', async () => {
    const files = await fixture('frank');
    const target = start(files);
    const authorization = target.auth(['builder']);
    const request = () => target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/spec',
      headers: { authorization },
    });

    const first = await request();
    expect(first.statusCode).toBe(200);
    await writeFile(join(files.release, 'graphify-out', 'graph.json'), '{corrupt immutable release');
    const cached = await request();
    expect(cached.statusCode).toBe(200);
    expect(cached.body).toBe(first.body);

    const nextRelease = join(files.projectRoot, 'releases', 'release-2');
    await mkdir(join(nextRelease, 'graphify-out'), { recursive: true });
    await writeFile(
      join(nextRelease, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [{ id: 'new-release', label: 'New release symbol' }], links: [] }),
    );
    await rm(join(files.projectRoot, 'current'));
    await symlink(join('releases', 'release-2'), join(files.projectRoot, 'current'), 'dir');
    const reloaded = await request();
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.body).toContain('New release symbol');
  });

  it('enforces the bounded read limiter across codegraph read routes for one principal', async () => {
    const files = await fixture('frank');
    const target = start(files, undefined, 2);
    const headers = { authorization: target.auth(['builder']) };
    expect((await target.app.inject({ method: 'GET', url: '/v1/codegraph/frank/spec', headers })).statusCode)
      .toBe(200);
    expect((await target.app.inject({ method: 'GET', url: '/v1/codegraph/frank/overview', headers })).statusCode)
      .toBe(200);
    const limited = await target.app.inject({ method: 'GET', url: '/v1/codegraph/projects', headers });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('authorizes BFF codegraph reads and refreshes with the actual production-mint output', async () => {
    const files = await fixture('frank');
    const signingKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const fetch = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') return Response.json(supervisorStatus());
      const commandId = (JSON.parse(String(init.body)) as { command_id: string }).command_id;
      return Response.json(
        {
          jobId: NEW_JOB,
          state: 'queued',
          commandId,
          requestedAt: '2026-08-11T00:02:00.000Z',
        },
        { status: 202 },
      );
    };
    const target = buildTestServer({
      config: { sessionSigningKey: signingKey },
      codegraph: {
        codegraphOutputDir: files.root,
        codegraphRegistryFile: files.registry,
        codegraphControlTokenFile: files.token,
        fetch: fetch as typeof globalThis.fetch,
      },
    });
    server = target;
    const serviceToken = mintServiceToken(
      {
        FRANK_SESSION_SIGNING_KEY: Buffer.from(signingKey).toString('hex'),
        FRANK_API_AUDIENCE: 'frank.api',
        FRANK_CELL_ID: 'cell-steven',
        FRANK_SERVICE_TOKEN_LIFETIME_SECONDS: '3600',
      },
      TEST_NOW,
    );
    const authenticated = await target.identityProvider.authenticate({
      scheme: 'Bearer',
      value: serviceToken,
    });
    expect(authenticated.authenticated).toBe(true);
    if (!authenticated.authenticated) throw new Error('production-mint token did not authenticate');
    expect(authenticated.principal.roles).toEqual(['service_identity']);
    expect(authenticated.principal.capabilities).toEqual(['codegraph.read', 'codegraph.refresh']);
    // The catch-all BFF adds this server-only token as the upstream Bearer
    // credential; app.inject exercises the complete API authenticate/authorize
    // and response path reached after that transparent forwarding step.
    const throughBff = (input: {
      method: 'GET' | 'POST';
      url: string;
      payload?: Record<string, unknown>;
    }) => target.app.inject({
      ...input,
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    const projects = await throughBff({ method: 'GET', url: '/v1/codegraph/projects' });
    expect(projects.statusCode).toBe(200);
    const refresh = await throughBff({
      method: 'POST',
      url: '/v1/codegraph/frank/refresh',
      payload: { command_id: 'cmd-bff-refresh-0001' },
    });
    expect(refresh.statusCode).toBe(202);
    expect(refresh.json()).toMatchObject({
      project_id: 'frank',
      command_id: 'cmd-bff-refresh-0001',
    });
  });

  it('rejects corrupt, oversized, excessive-attribute, and excessive-count graphs', async () => {
    const files = await fixture('frank');
    const target = start(files);
    const request = async (): Promise<number> =>
      (await target.app.inject({
        method: 'GET',
        url: '/v1/codegraph/frank/spec',
        headers: { authorization: target.auth(['builder']) },
      })).statusCode;

    await writeFile(join(files.release, 'graphify-out', 'graph.json'), '{not json');
    expect(await request()).toBe(503);
    await writeFile(
      join(files.release, 'graphify-out', 'graph.json'),
      ' '.repeat(32 * 1024 * 1024 + 1),
    );
    expect(await request()).toBe(503);
    await writeFile(
      join(files.release, 'graphify-out', 'graph.json'),
      JSON.stringify({ nodes: [{ id: 'one', label: 'x'.repeat(32_769) }], links: [] }),
    );
    expect(await request()).toBe(503);
    await writeFile(
      join(files.release, 'graphify-out', 'graph.json'),
      JSON.stringify({
        nodes: [
          {
            id: 'one',
            ...Object.fromEntries(
              Array.from({ length: 65 }, (_, index) => [`attribute-${index}`, index]),
            ),
          },
        ],
        links: [],
      }),
    );
    expect(await request()).toBe(503);
    await writeFile(
      join(files.release, 'graphify-out', 'graph.json'),
      JSON.stringify({
        nodes: Array.from({ length: 50_001 }, (_, index) => ({ id: `node-${index}` })),
        links: [],
      }),
    );
    expect(await request()).toBe(503);
  });

  it('rejects release selectors that resolve outside project releases', async () => {
    const files = await fixture('frank');
    const outside = join(files.root, 'outside-release');
    await mkdir(join(outside, 'graphify-out'), { recursive: true });
    await rm(join(files.projectRoot, 'current'));
    await symlink(outside, join(files.projectRoot, 'current'), 'dir');
    const target = start(files);
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/codegraph/frank/spec',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(503);
  });
});
