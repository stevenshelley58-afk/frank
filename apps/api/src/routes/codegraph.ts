/**
 * /v1/codegraph — code intelligence graph endpoints.
 *
 * Reads pre-built graph JSON from the codegraph service's output directory.
 * The codegraph container writes files; this route just serves them.
 * Zero coupling to the request path — if the file isn't there, 404.
 *
 * Endpoints:
 *   GET  /v1/codegraph/projects          — list available projects
 *   GET  /v1/codegraph/:project/spec     — PipelineSpec for the frontend
 *   GET  /v1/codegraph/:project/graph    — full ProjectGraph (raw)
 *   GET  /v1/codegraph/:project/status   — build status + stats
 *   POST /v1/codegraph/:project/refresh  — trigger re-scan (via codegraph HTTP)
 */

import type { FastifyInstance } from 'fastify';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const CODEGRAPH_DIR = process.env.CODEGRAPH_OUTPUT ?? '/data/codegraph';
const CODEGRAPH_STATUS_URL = process.env.CODEGRAPH_STATUS_URL ?? 'http://frank-codegraph:3002';

type RouteDeps = {
  cellId: string;
  policyVersion: string;
  identity: unknown;
  now: () => Date;
};

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listProjects(): Promise<Array<{ id: string; hasGraph: boolean; hasSpec: boolean; generatedAt: string | null }>> {
  try {
    const entries = await readdir(CODEGRAPH_DIR, { withFileTypes: true });
    const projects: Array<{ id: string; hasGraph: boolean; hasSpec: boolean; generatedAt: string | null }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(CODEGRAPH_DIR, entry.name);
      let hasGraph = false;
      let hasSpec = false;
      let generatedAt: string | null = null;

      try {
        await stat(join(dir, 'graph.min.json'));
        hasGraph = true;
      } catch { /* no graph */ }

      try {
        await stat(join(dir, 'spec.json'));
        hasSpec = true;
      } catch { /* no spec */ }

      if (hasGraph) {
        const g = await readJson(join(dir, 'graph.min.json')) as { generatedAt?: string } | null;
        generatedAt = g?.generatedAt ?? null;
      }

      projects.push({ id: entry.name, hasGraph, hasSpec, generatedAt });
    }

    return projects;
  } catch {
    return [];
  }
}

export function registerCodegraphRoutes(app: FastifyInstance, _deps: RouteDeps): void {
  // List projects
  app.get('/v1/codegraph/projects', async (_request, reply) => {
    const projects = await listProjects();
    return { projects };
  });

  // PipelineSpec (for the frontend graph component)
  app.get('/v1/codegraph/:project/spec', async (request, reply) => {
    const { project } = request.params as { project: string };
    // Sanitize: no path traversal
    if (project.includes('..') || project.includes('/') || project.includes('\\')) {
      void reply.code(400);
      return { error: 'Invalid project id' };
    }

    const spec = await readJson(join(CODEGRAPH_DIR, project, 'spec.json'));
    if (!spec) {
      void reply.code(404);
      return { error: `No graph found for project "${project}". Is the codegraph service running?` };
    }
    return spec;
  });

  // Full raw graph
  app.get('/v1/codegraph/:project/graph', async (request, reply) => {
    const { project } = request.params as { project: string };
    if (project.includes('..') || project.includes('/') || project.includes('\\')) {
      void reply.code(400);
      return { error: 'Invalid project id' };
    }

    const graph = await readJson(join(CODEGRAPH_DIR, project, 'graph.min.json'));
    if (!graph) {
      void reply.code(404);
      return { error: `No graph found for project "${project}".` };
    }
    return graph;
  });

  // Status / stats
  app.get('/v1/codegraph/:project/status', async (request, reply) => {
    const { project } = request.params as { project: string };
    if (project.includes('..') || project.includes('/') || project.includes('\\')) {
      void reply.code(400);
      return { error: 'Invalid project id' };
    }

    const graph = await readJson(join(CODEGRAPH_DIR, project, 'graph.min.json')) as {
      fileCount?: number; symbolCount?: number; relationCount?: number;
      generatedAt?: string; errors?: unknown[];
    } | null;

    if (!graph) {
      void reply.code(404);
      return { error: `No graph found for project "${project}".` };
    }

    return {
      projectId: project,
      fileCount: graph.fileCount ?? 0,
      symbolCount: graph.symbolCount ?? 0,
      relationCount: graph.relationCount ?? 0,
      generatedAt: graph.generatedAt ?? null,
      errorCount: graph.errors?.length ?? 0,
    };
  });

  // Trigger refresh (proxies to codegraph service)
  app.post('/v1/codegraph/:project/refresh', async (request, reply) => {
    const { project } = request.params as { project: string };
    if (project.includes('..') || project.includes('/') || project.includes('\\')) {
      void reply.code(400);
      return { error: 'Invalid project id' };
    }

    try {
      const response = await fetch(`${CODEGRAPH_STATUS_URL}/status`);
      const status = await response.json() as { projects: Array<{ id: string; building: boolean }> };
      const proj = status.projects.find((p) => p.id === project);

      if (!proj) {
        void reply.code(404);
        return { error: `Project "${project}" is not registered with the codegraph service.` };
      }

      return {
        projectId: project,
        building: proj.building,
        message: proj.building
          ? 'A rebuild is already in progress.'
          : 'Refresh requested. The codegraph service will rebuild on its next debounce cycle.',
      };
    } catch {
      void reply.code(503);
      return { error: 'Cannot reach the codegraph service. Is it running?' };
    }
  });
}
