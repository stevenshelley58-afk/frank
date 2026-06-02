import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";
import { runHostOperation } from "./aionui.js";

const createProjectSchema = z
  .object({
    slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/),
    displayName: z.string().trim().min(1).max(160),
    workspacePath: z.string().trim().min(1).optional(),
    repoRemote: z.string().trim().min(1).max(500).nullable().optional(),
    backupPolicy: z.string().trim().min(1).max(80).default("local_vps"),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

interface ProjectRow {
  id: string;
  slug: string;
  display_name: string;
  workspace_path: string;
  repo_remote: string | null;
  backup_policy: string;
  status: "active" | "paused" | "archived";
  metadata: Record<string, unknown>;
  last_activity_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function registerProjectRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/projects", async () => {
    const result = await pool.query<ProjectRow>(
      `
        select ${projectSelectColumns}
        from projects
        order by updated_at desc, created_at desc
      `
    );
    return {
      projects: result.rows.map(serializeProject)
    };
  });

  server.post("/v1/projects", async (request, reply) => {
    const body = createProjectSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const workspacePath = normalizeOperatorPath(body.data.workspacePath ?? `/opt/frank-projects/${body.data.slug}`);
    if (
      isInsideAnyOperatorPath(workspacePath, config.operator.protectedPaths) ||
      !isInsideAnyOperatorPath(workspacePath, config.operator.allowedWorkspaces)
    ) {
      return reply.code(400).send({
        error: "invalid_project_workspace",
        message: "Project workspace must be inside the configured operator workspace allowlist and outside protected paths."
      });
    }

    const actorId = getRequestActorId(request);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<ProjectRow>(
        `
          insert into projects (
            slug,
            display_name,
            workspace_path,
            repo_remote,
            backup_policy,
            metadata
          )
          values ($1, $2, $3, $4, $5, $6::jsonb)
          returning ${projectSelectColumns}
        `,
        [
          body.data.slug,
          body.data.displayName,
          workspacePath,
          body.data.repoRemote ?? null,
          body.data.backupPolicy,
          JSON.stringify(body.data.metadata ?? {})
        ]
      );
      const project = inserted.rows[0];
      if (!project) {
        throw new Error("Project insert did not return a row.");
      }
      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "project.create",
        targetType: "project",
        targetId: project.id,
        outcome: "success",
        metadata: {
          slug: project.slug,
          workspacePath: project.workspace_path
        }
      });
      await client.query("commit");
      return reply.code(201).send({ project: serializeProject(project) });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.post("/v1/projects/import-c-dev", async (request) => {
    const result = await runHostOperation(config, "projects.import_c_dev");
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId: getRequestActorId(request),
      action: "project.import_c_dev",
      targetType: "project_inventory",
      targetId: "c-dev",
      outcome: result.ok ? "success" : "failure",
      metadata: {
        message: result.message
      }
    });
    return result;
  });

  server.post("/v1/projects/materialize-c-dev", async (request) => {
    const result = await runHostOperation(config, "projects.materialize_c_dev");
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId: getRequestActorId(request),
      action: "project.materialize_c_dev",
      targetType: "project_inventory",
      targetId: "c-dev",
      outcome: result.ok ? "success" : "failure",
      metadata: {
        message: result.message
      }
    });
    return result;
  });
}

const projectSelectColumns = `
  id,
  slug,
  display_name,
  workspace_path,
  repo_remote,
  backup_policy,
  status,
  metadata,
  last_activity_at,
  created_at,
  updated_at
`;

function serializeProject(row: ProjectRow) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    workspacePath: row.workspace_path,
    repoRemote: row.repo_remote,
    backupPolicy: row.backup_policy,
    status: row.status,
    metadata: row.metadata,
    lastActivityAt: serializeNullableTimestamp(row.last_activity_at),
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function isInsideAnyOperatorPath(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => isInsideOperatorPath(candidate, root));
}

function isInsideOperatorPath(candidate: string, root: string): boolean {
  const normalizedRoot = normalizeOperatorPath(root);
  if (!normalizedRoot) {
    return false;
  }
  if (normalizedRoot === "/") {
    return candidate === "/";
  }
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}

function normalizeOperatorPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    message: "Request validation failed.",
    details: error.flatten()
  });
}

function getRequestActorId(request: FastifyRequest): string {
  return request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown";
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeNullableTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return serializeTimestamp(value);
}
