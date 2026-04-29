import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createHermesRunnerAdapter } from "@frank/hermes-runner";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const execFileAsync = promisify(execFile);

const backupTypeSchema = z.enum(["postgres", "files", "preflight"]);
const killSwitchSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional()
  })
  .strict();

interface BackupRunRow {
  id: string;
  backup_type: "postgres" | "files" | "preflight";
  status: "running" | "completed" | "failed";
  path: string | null;
  size_bytes: number | null;
  branch: string | null;
  commit: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  finished_at: Date | string | null;
}

interface ActiveSessionRow {
  id: string;
  task_id: string | null;
  hermes_run_id: string | null;
  status: "queued" | "starting" | "running" | "stopping";
}

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export function registerBackupRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.post("/v1/backups/preflight", async (request) => {
    const actorId = getRequestActorId(request);
    const git = await gitStatus();
    const metadata = {
      git,
      backupRoot: config.backups.root,
      artifactRoot: config.hermes.artifactRoot,
      hostingerSnapshotReminder: "Recommended before destructive restore or catastrophic operator tasks.",
      envCommittedCheck: "Frank ignores .env and .env.* except .env.example."
    };
    const run = await createCompletedBackupRun(pool, {
      backupType: "preflight",
      path: null,
      sizeBytes: null,
      branch: git.branch,
      commit: git.commit,
      metadata
    });
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId,
      action: "backup.preflight",
      targetType: "backup_run",
      targetId: run.id,
      outcome: "success",
      metadata
    });
    return { backup: serializeBackupRun(run), status: metadata };
  });

  server.get("/v1/backups/status", async () => {
    const result = await pool.query<BackupRunRow>(
      `
        select distinct on (backup_type) ${backupRunSelectColumns}
        from backup_runs
        order by backup_type, created_at desc
      `
    );
    return {
      backups: result.rows.map(serializeBackupRun),
      backupRoot: config.backups.root
    };
  });

  server.get("/v1/backups", async (request, reply) => {
    const query = z
      .object({
        backup_type: backupTypeSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50)
      })
      .safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const values: unknown[] = [];
    const where: string[] = [];
    if (query.data.backup_type) {
      values.push(query.data.backup_type);
      where.push(`backup_type = $${values.length}`);
    }
    values.push(query.data.limit);

    const result = await pool.query<BackupRunRow>(
      `
        select ${backupRunSelectColumns}
        from backup_runs
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by created_at desc
        limit $${values.length}
      `,
      values
    );
    return { backups: result.rows.map(serializeBackupRun) };
  });

  server.post("/v1/backups/postgres", async (request, reply) => {
    const actorId = getRequestActorId(request);
    const run = await createRunningBackupRun(pool, "postgres");
    try {
      const backup = await createPostgresBackup(config, run.id);
      const completed = await finishBackupRun(pool, run.id, "completed", backup);
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "backup.postgres",
        targetType: "backup_run",
        targetId: run.id,
        outcome: "success",
        metadata: {
          path: backup.path,
          sizeBytes: backup.sizeBytes
        }
      });
      return reply.code(201).send({ backup: serializeBackupRun(completed) });
    } catch (error) {
      const failed = await finishBackupRun(pool, run.id, "failed", {
        path: null,
        sizeBytes: null,
        branch: null,
        commit: null,
        metadata: {
          error: errorMessage(error)
        }
      });
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "backup.postgres",
        targetType: "backup_run",
        targetId: run.id,
        outcome: "failure",
        metadata: {
          error: errorMessage(error)
        }
      });
      return reply.code(500).send({ backup: serializeBackupRun(failed), error: "backup_failed", message: errorMessage(error) });
    }
  });

  server.post("/v1/backups/files", async (request, reply) => {
    const actorId = getRequestActorId(request);
    const run = await createRunningBackupRun(pool, "files");
    try {
      const backup = await createFilesBackup(config, run.id);
      const completed = await finishBackupRun(pool, run.id, "completed", backup);
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "backup.files",
        targetType: "backup_run",
        targetId: run.id,
        outcome: "success",
        metadata: {
          path: backup.path,
          sizeBytes: backup.sizeBytes
        }
      });
      return reply.code(201).send({ backup: serializeBackupRun(completed) });
    } catch (error) {
      const failed = await finishBackupRun(pool, run.id, "failed", {
        path: null,
        sizeBytes: null,
        branch: null,
        commit: null,
        metadata: {
          error: errorMessage(error)
        }
      });
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "backup.files",
        targetType: "backup_run",
        targetId: run.id,
        outcome: "failure",
        metadata: {
          error: errorMessage(error)
        }
      });
      return reply.code(500).send({ backup: serializeBackupRun(failed), error: "backup_failed", message: errorMessage(error) });
    }
  });

  server.post("/v1/runners/hermes/kill-switch", async (request, reply) => {
    const body = killSwitchSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const reason = body.data.reason ?? "Hermes kill switch requested from Frank Hub.";
    const active = await pool.query<ActiveSessionRow>(
      `
        select id, task_id, hermes_run_id, status
        from runner_sessions
        where runner_id = 'hermes'
          and status in ('queued', 'starting', 'running', 'stopping')
        order by created_at asc
      `
    );

    const adapter = createHermesRunnerAdapter(config.hermes);
    const outcomes = [];
    for (const session of active.rows) {
      const stop = await adapter.stopRun({
        runnerSessionId: session.id,
        hermesRunId: session.hermes_run_id,
        reason
      });
      const status = stop.stopped ? "cancelled" : "failed";
      await markSessionKilled(pool, session, status, stop.message, stop.method);
      outcomes.push({
        sessionId: session.id,
        taskId: session.task_id,
        stopped: stop.stopped,
        method: stop.method,
        message: stop.message
      });
    }

    await pool.query(
      `
        insert into kill_switch_events (scope, reason, affected_sessions, outcome)
        values ('hermes', $1, $2::jsonb, $3)
      `,
      [reason, JSON.stringify(outcomes), outcomes.every((outcome) => outcome.stopped) ? "success" : "partial"]
    );
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId,
      action: "runner.hermes.kill_switch",
      targetType: "runner",
      targetId: "hermes",
      outcome: outcomes.every((outcome) => outcome.stopped) ? "success" : "failure",
      metadata: {
        affectedSessions: outcomes.length
      }
    });

    return {
      scope: "hermes",
      affectedSessions: outcomes,
      outcome: outcomes.every((outcome) => outcome.stopped) ? "success" : "partial"
    };
  });
}

async function createRunningBackupRun(pool: PgPool, backupType: BackupRunRow["backup_type"]): Promise<BackupRunRow> {
  const result = await pool.query<BackupRunRow>(
    `
      insert into backup_runs (backup_type, status, metadata)
      values ($1, 'running', '{}'::jsonb)
      returning ${backupRunSelectColumns}
    `,
    [backupType]
  );
  return requireRow(result.rows[0], "Backup run insert did not return a row.");
}

async function createCompletedBackupRun(
  db: Queryable,
  input: {
    backupType: BackupRunRow["backup_type"];
    path: string | null;
    sizeBytes: number | null;
    branch: string | null;
    commit: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<BackupRunRow> {
  const result = await db.query<BackupRunRow>(
    `
      insert into backup_runs (
        backup_type,
        status,
        path,
        size_bytes,
        branch,
        commit,
        metadata,
        finished_at
      )
      values ($1, 'completed', $2, $3, $4, $5, $6::jsonb, now())
      returning ${backupRunSelectColumns}
    `,
    [input.backupType, input.path, input.sizeBytes, input.branch, input.commit, JSON.stringify(input.metadata)]
  );
  return requireRow(result.rows[0], "Backup run insert did not return a row.");
}

async function finishBackupRun(
  pool: PgPool,
  id: string,
  status: BackupRunRow["status"],
  input: { path: string | null; sizeBytes: number | null; branch: string | null; commit: string | null; metadata: Record<string, unknown> }
): Promise<BackupRunRow> {
  const result = await pool.query<BackupRunRow>(
    `
      update backup_runs
      set
        status = $2,
        path = $3,
        size_bytes = $4,
        branch = $5,
        commit = $6,
        metadata = metadata || $7::jsonb,
        finished_at = now()
      where id = $1
      returning ${backupRunSelectColumns}
    `,
    [id, status, input.path, input.sizeBytes, input.branch, input.commit, JSON.stringify(input.metadata)]
  );
  return requireRow(result.rows[0], "Backup run update did not return a row.");
}

async function createPostgresBackup(config: ApiConfig, runId: string) {
  const backupDir = path.join(config.backups.root, "postgres");
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `frank-postgres-${timestamp()}-${runId}.dump`);
  const db = new URL(config.databaseUrl);
  const git = await gitStatus();
  await execFileAsync(
    "pg_dump",
    [
      "-h",
      db.hostname,
      "-p",
      db.port || "5432",
      "-U",
      decodeURIComponent(db.username),
      "-d",
      db.pathname.replace(/^\//, ""),
      "-Fc",
      "-f",
      backupPath
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(db.password)
      },
      timeout: 15 * 60 * 1000
    }
  );
  const info = await stat(backupPath);
  if (info.size <= 0) {
    throw new Error("Postgres backup file was empty.");
  }
  return { path: backupPath, sizeBytes: info.size, branch: git.branch, commit: git.commit, metadata: { command: "pg_dump" } };
}

async function createFilesBackup(config: ApiConfig, runId: string) {
  const backupDir = path.join(config.backups.root, "files");
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `frank-files-${timestamp()}-${runId}.tar.gz`);
  const git = await gitStatus();
  await execFileAsync(
    "tar",
    [
      "--exclude=./node_modules",
      "--exclude=./.turbo",
      "--exclude=./apps/*/dist",
      "--exclude=./packages/*/dist",
      "--exclude=./runtime/hermes",
      "--exclude=./runtime/artifacts",
      "--exclude=./workspaces",
      "-czf",
      backupPath,
      "-C",
      process.cwd(),
      "."
    ],
    { timeout: 15 * 60 * 1000 }
  );
  const info = await stat(backupPath);
  if (info.size <= 0) {
    throw new Error("File backup archive was empty.");
  }
  return { path: backupPath, sizeBytes: info.size, branch: git.branch, commit: git.commit, metadata: { command: "tar" } };
}

async function gitStatus(): Promise<{ branch: string | null; commit: string | null; available: boolean }> {
  try {
    const [branch, commit] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
      execFileAsync("git", ["rev-parse", "HEAD"])
    ]);
    return {
      branch: branch.stdout.trim() || null,
      commit: commit.stdout.trim() || null,
      available: true
    };
  } catch {
    return {
      branch: null,
      commit: null,
      available: false
    };
  }
}

async function markSessionKilled(
  pool: PgPool,
  session: ActiveSessionRow,
  status: "cancelled" | "failed",
  message: string,
  method: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        update runner_sessions
        set status = $2, finished_at = now(), error_summary = $3, updated_at = now()
        where id = $1
      `,
      [session.id, status, message]
    );
    if (session.task_id) {
      await client.query(
        `
          update tasks
          set state = $2, finished_at = now(), last_error = $3, updated_at = now()
          where id = $1
        `,
        [session.task_id, status, message]
      );
      await client.query(
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
          values ($1, 'task.hermes_kill_switch', 'system', 'frank', null, $2, $3, $4, $5::jsonb)
        `,
        [session.task_id, status, status === "cancelled" ? "warn" : "error", message, JSON.stringify({ method })]
      );
    }
    await client.query(
      `
        insert into runner_events (
          runner_session_id,
          task_id,
          source,
          event_type,
          severity,
          message,
          raw_event,
          sequence
        )
        values (
          $1,
          $2,
          'frank',
          'runner.kill_switch',
          $3,
          $4,
          $5::jsonb,
          coalesce((select max(sequence) + 1 from runner_events where runner_session_id = $1), 1)
        )
      `,
      [
        session.id,
        session.task_id,
        status === "cancelled" ? "success" : "error",
        message,
        JSON.stringify({ method })
      ]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const backupRunSelectColumns = `
  id,
  backup_type,
  status,
  path,
  size_bytes,
  branch,
  commit,
  metadata,
  created_at,
  finished_at
`;

function serializeBackupRun(row: BackupRunRow) {
  return {
    id: row.id,
    backupType: row.backup_type,
    status: row.status,
    path: row.path,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    branch: row.branch,
    commit: row.commit,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    finishedAt: serializeNullableTimestamp(row.finished_at)
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Backup operation failed.";
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
