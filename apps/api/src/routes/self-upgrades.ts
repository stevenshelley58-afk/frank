import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";
import { runHostOperation } from "./aionui.js";

const execFileAsync = promisify(execFile);

const validationGate = [
  "pnpm typecheck",
  "pnpm test",
  "pnpm build",
  "docker compose config",
  "docker compose -f docker-compose.yml -f docker-compose.hermes.yml config",
  "git diff --check",
  "secret scan",
  "migration review",
  "healthcheck",
  "hermes check"
] as const;

const createSelfUpgradeSchema = z
  .object({
    goal: z.string().trim().min(1).max(4000),
    autoDeploy: z.boolean().default(true),
    limits: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

const uuidParamSchema = z.object({
  id: z.string().uuid()
});

const reasonSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional()
  })
  .strict();

interface SelfUpgradeRunRow {
  id: string;
  goal: string;
  status: "queued" | "running" | "waiting_approval" | "deploying" | "completed" | "failed" | "cancelled" | "rolled_back";
  auto_deploy: boolean;
  branch: string;
  base_commit: string | null;
  task_id: string | null;
  runner_session_id: string | null;
  workspace_path: string;
  backup_ids: string[];
  limits: Record<string, unknown>;
  validation_results: Record<string, unknown>;
  deploy_result: Record<string, unknown>;
  rollback_target: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  state: string;
  priority: number;
  created_by: string | null;
  assigned_agent_id: string | null;
  execution_kind: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export function registerSelfUpgradeRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/self-upgrades", async () => {
    const result = await pool.query<SelfUpgradeRunRow>(
      `
        select ${selfUpgradeSelectColumns}
        from self_upgrade_runs
        order by created_at desc
        limit 50
      `
    );
    return {
      selfUpgradeRuns: result.rows.map(serializeSelfUpgradeRun)
    };
  });

  server.get("/v1/self-upgrades/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const run = await findSelfUpgradeRun(pool, params.data.id);
    if (!run) {
      return reply.code(404).send({
        error: "self_upgrade_not_found",
        message: "Self-upgrade run not found."
      });
    }

    return {
      selfUpgradeRun: serializeSelfUpgradeRun(run)
    };
  });

  server.post("/v1/self-upgrades/check-latest", async (request) => {
    const result = await runHostOperation(config, "frank.check_latest");
    const check = parseLatestCheck(result.output);
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId: getRequestActorId(request),
      action: "self_upgrade.check_latest",
      targetType: "self_upgrade_run",
      outcome: result.ok ? "success" : "failure",
      metadata: {
        check
      }
    });
    return {
      queued: false,
      requiresApproval: Boolean(check.updateAvailable),
      check,
      suggestedGoal: check.updateAvailable
        ? `Update Frank Hub to latest ${stringValue(check.remote, "origin")}/${stringValue(check.branch, "main")} (${stringValue(check.remoteCommit, "unknown")}) and verify in production with backups and rollback.`
        : null
    };
  });

  server.post("/v1/self-upgrades", async (request, reply) => {
    const body = createSelfUpgradeSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }
    if (config.operator.mode !== "lab") {
      return reply.code(403).send({
        error: "self_upgrade_requires_lab",
        message: "Self-upgrade auto-deploy runs require FRANK_OPERATOR_MODE=lab."
      });
    }

    const actorId = getRequestActorId(request);
    const baseCommit = await currentCommit();
    const branch = selfUpgradeBranch(body.data.goal);
    const workspacePath = config.operator.repoWorkspacePath;
    const selfUpgradeRunId = randomUUID();
    const limits = {
      ...config.operator.limits,
      ...(body.data.limits ?? {})
    };
    const metadata = {
      ...(body.data.metadata ?? {}),
      kind: "self_upgrade",
      workspacePath,
      selfUpgradeRunId,
      autoDeploy: body.data.autoDeploy,
      validationGate: [...validationGate],
      branch,
      baseCommit,
      backupPolicy: "local_vps_preflight"
    };

    const client = await pool.connect();
    try {
      await client.query("begin");
      const task = await createHermesTask(client, {
        title: `Self-upgrade: ${body.data.goal.slice(0, 96)}`,
        description: selfUpgradePrompt(body.data.goal, workspacePath),
        actorId,
        workspacePath,
        metadata
      });
      const run = await client.query<SelfUpgradeRunRow>(
        `
          insert into self_upgrade_runs (
            id,
            goal,
            status,
            auto_deploy,
            branch,
            base_commit,
            task_id,
            workspace_path,
            limits,
            metadata,
            created_by
          )
          values ($1, $2, 'queued', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
          returning ${selfUpgradeSelectColumns}
        `,
        [
          selfUpgradeRunId,
          body.data.goal,
          body.data.autoDeploy,
          branch,
          baseCommit,
          task.id,
          workspacePath,
          JSON.stringify(limits),
          JSON.stringify(metadata),
          actorId
        ]
      );
      const selfUpgradeRun = requireRow(run.rows[0], "Self-upgrade insert did not return a row.");
      await insertTaskEvent(client, {
        taskId: task.id,
        actorId,
        eventType: "self_upgrade.queued",
        metadata: {
          selfUpgradeRunId: selfUpgradeRun.id,
          branch
        }
      });
      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "self_upgrade.create",
        targetType: "self_upgrade_run",
        targetId: selfUpgradeRun.id,
        outcome: "success",
        metadata: {
          taskId: task.id,
          branch,
          autoDeploy: body.data.autoDeploy
        }
      });
      await client.query("commit");
      return reply.code(201).send({
        selfUpgradeRun: serializeSelfUpgradeRun(selfUpgradeRun),
        task: serializeTask(task)
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.post("/v1/self-upgrades/:id/cancel", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const body = reasonSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const run = await findSelfUpgradeRun(pool, params.data.id);
    if (!run) {
      return reply.code(404).send({
        error: "self_upgrade_not_found",
        message: "Self-upgrade run not found."
      });
    }
    if (isTerminalStatus(run.status)) {
      return reply.code(409).send({
        error: "self_upgrade_terminal",
        message: "Self-upgrade run is already terminal.",
        selfUpgradeRun: serializeSelfUpgradeRun(run)
      });
    }

    const actorId = getRequestActorId(request);
    const metadata = {
      cancelReason: body.data.reason ?? "Cancelled from Frank Hub.",
      cancelledBy: actorId,
      cancelledAt: new Date().toISOString()
    };
    const cancelled = await updateSelfUpgradeStatus(pool, run.id, "cancelled", metadata);
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId,
      action: "self_upgrade.cancel",
      targetType: "self_upgrade_run",
      targetId: run.id,
      outcome: "success",
      metadata: {
        reason: metadata.cancelReason
      }
    });

    return {
      selfUpgradeRun: serializeSelfUpgradeRun(cancelled)
    };
  });

  server.post("/v1/self-upgrades/:id/rollback", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const body = reasonSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }
    if (config.operator.mode !== "lab") {
      return reply.code(403).send({
        error: "rollback_requires_lab",
        message: "Self-upgrade rollback tasks require FRANK_OPERATOR_MODE=lab."
      });
    }

    const run = await findSelfUpgradeRun(pool, params.data.id);
    if (!run) {
      return reply.code(404).send({
        error: "self_upgrade_not_found",
        message: "Self-upgrade run not found."
      });
    }

    const actorId = getRequestActorId(request);
    const reason = body.data.reason ?? "Rollback requested from Frank Hub.";
    const rollbackMetadata = {
      kind: "self_upgrade_rollback",
      selfUpgradeRunId: run.id,
      workspacePath: run.workspace_path,
      branch: run.branch,
      baseCommit: run.base_commit,
      rollbackTarget: run.rollback_target,
      reason
    };

    const client = await pool.connect();
    try {
      await client.query("begin");
      const task = await createHermesTask(client, {
        title: `Rollback self-upgrade: ${run.goal.slice(0, 80)}`,
        description: rollbackPrompt(run),
        actorId,
        workspacePath: run.workspace_path,
        metadata: rollbackMetadata
      });
      const updated = await markRollbackRequested(client, run.id, {
        rollbackRequested: true,
        rollbackTaskId: task.id,
        rollbackRequestedBy: actorId,
        rollbackRequestedAt: new Date().toISOString(),
        rollbackReason: reason
      });
      await insertTaskEvent(client, {
        taskId: task.id,
        actorId,
        eventType: "self_upgrade.rollback_queued",
        metadata: {
          selfUpgradeRunId: run.id
        }
      });
      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "self_upgrade.rollback",
        targetType: "self_upgrade_run",
        targetId: run.id,
        outcome: "success",
        metadata: {
          taskId: task.id
        }
      });
      await client.query("commit");

      return reply.code(202).send({
        selfUpgradeRun: serializeSelfUpgradeRun(updated),
        task: serializeTask(task)
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });
}

function parseLatestCheck(output: string | undefined): Record<string, unknown> {
  if (!output?.trim()) {
    return {
      updateAvailable: false,
      message: "No latest-check output was returned."
    };
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {
      updateAvailable: false,
      message: output.trim()
    };
  }
  return {
    updateAvailable: false,
    message: output.trim()
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

async function createHermesTask(
  db: Queryable,
  input: {
    title: string;
    description: string;
    actorId: string;
    workspacePath: string;
    metadata: Record<string, unknown>;
  }
): Promise<TaskRow> {
  const result = await db.query<TaskRow>(
    `
      insert into tasks (
        title,
        description,
        state,
        priority,
        created_by,
        assigned_agent_id,
        execution_kind,
        metadata
      )
      values ($1, $2, 'queued', $3, $4, $5, $6, $7::jsonb)
      returning
        id,
        title,
        description,
        state,
        priority,
        created_by,
        assigned_agent_id,
        execution_kind,
        metadata,
        created_at,
        updated_at
    `,
    [
      input.title,
      input.description,
      10,
      input.actorId,
      "ops",
      "hermes_operator",
      JSON.stringify(input.metadata)
    ]
  );
  return requireRow(result.rows[0], "Self-upgrade task insert did not return a row.");
}

function selfUpgradePrompt(goal: string, workspacePath: string): string {
  return `Run a Frank Hub self-upgrade in lab mode.

Goal:
${goal}

Required workflow:
- Work in ${workspacePath}.
- Create local VPS backups before risky changes.
- Use branch frank/self-upgrade/<timestamp>-<slug>.
- Run the validation gate from task metadata.
- Auto-deploy only if every validation step passes.
- Roll back if deploy or health checks fail.
- Never print or commit secrets.`;
}

function rollbackPrompt(run: SelfUpgradeRunRow): string {
  return `Run a Frank Hub self-upgrade rollback in lab mode.

Original goal:
${run.goal}

Required workflow:
- Work in ${run.workspace_path}.
- Inspect current git status before changing anything.
- Prefer restoring the previous branch/commit from base commit ${run.base_commit ?? "not recorded"}.
- Use local VPS backups under /opt/frank-backups only as rollback evidence unless explicit destructive restore is required.
- Run the validation gate again after rollback.
- Redeploy the previous healthy state only if checks pass.
- Never print or commit secrets.
- Return a final concise rollback report.`;
}

async function findSelfUpgradeRun(db: Queryable, id: string): Promise<SelfUpgradeRunRow | undefined> {
  const result = await db.query<SelfUpgradeRunRow>(
    `
      select ${selfUpgradeSelectColumns}
      from self_upgrade_runs
      where id = $1
    `,
    [id]
  );
  return result.rows[0];
}

async function updateSelfUpgradeStatus(
  db: Queryable,
  id: string,
  status: SelfUpgradeRunRow["status"],
  metadata: Record<string, unknown>
): Promise<SelfUpgradeRunRow> {
  const result = await db.query<SelfUpgradeRunRow>(
    `
      update self_upgrade_runs
      set
        status = $2,
        metadata = metadata || $3::jsonb,
        finished_at = now(),
        updated_at = now()
      where id = $1
      returning ${selfUpgradeSelectColumns}
    `,
    [id, status, JSON.stringify(metadata)]
  );
  return requireRow(result.rows[0], "Self-upgrade status update did not return a row.");
}

async function markRollbackRequested(
  db: Queryable,
  id: string,
  metadata: Record<string, unknown>
): Promise<SelfUpgradeRunRow> {
  const result = await db.query<SelfUpgradeRunRow>(
    `
      update self_upgrade_runs
      set
        metadata = metadata || $2::jsonb,
        updated_at = now()
      where id = $1
      returning ${selfUpgradeSelectColumns}
    `,
    [id, JSON.stringify(metadata)]
  );
  return requireRow(result.rows[0], "Self-upgrade rollback update did not return a row.");
}

function isTerminalStatus(status: SelfUpgradeRunRow["status"]): boolean {
  return ["completed", "failed", "cancelled", "rolled_back"].includes(status);
}

async function insertTaskEvent(
  db: Queryable,
  event: { taskId: string; actorId: string; eventType: string; metadata: Record<string, unknown> }
): Promise<void> {
  await db.query(
    `
      insert into task_events (
        task_id,
        event_type,
        actor_type,
        actor_id,
        from_state,
        to_state,
        severity,
        message,
        metadata
      )
      values ($1, $2, 'user', $3, null, 'queued', 'info', 'Self-upgrade queued for Hermes.', $4::jsonb)
    `,
    [event.taskId, event.eventType, event.actorId, JSON.stringify(event.metadata)]
  );
}

function selfUpgradeBranch(goal: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").toLowerCase();
  return `frank/self-upgrade/${timestamp}-${slugify(goal)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "upgrade";
}

async function currentCommit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      timeout: 2000,
      windowsHide: true
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

const selfUpgradeSelectColumns = `
  id,
  goal,
  status,
  auto_deploy,
  branch,
  base_commit,
  task_id,
  runner_session_id,
  workspace_path,
  backup_ids,
  limits,
  validation_results,
  deploy_result,
  rollback_target,
  metadata,
  created_by,
  created_at,
  updated_at,
  finished_at
`;

function serializeSelfUpgradeRun(row: SelfUpgradeRunRow) {
  return {
    id: row.id,
    goal: row.goal,
    status: row.status,
    autoDeploy: row.auto_deploy,
    branch: row.branch,
    baseCommit: row.base_commit,
    taskId: row.task_id,
    runnerSessionId: row.runner_session_id,
    workspacePath: row.workspace_path,
    backupIds: row.backup_ids ?? [],
    limits: row.limits,
    validationResults: row.validation_results,
    deployResult: row.deploy_result,
    rollbackTarget: row.rollback_target,
    metadata: row.metadata,
    createdBy: row.created_by,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at),
    finishedAt: serializeNullableTimestamp(row.finished_at)
  };
}

function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    state: row.state,
    priority: row.priority,
    createdBy: row.created_by,
    assignedAgentId: row.assigned_agent_id,
    executionKind: row.execution_kind,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function requireRow<Row>(row: Row | undefined, message: string): Row {
  if (!row) {
    throw new Error(message);
  }
  return row;
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
