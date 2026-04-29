import {
  createHermesRunnerAdapter,
  redactSecrets,
  type HermesHealthResult,
  type RunnerEvent
} from "@frank/hermes-runner";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const uuidParamSchema = z.object({
  id: z.string().uuid()
});

const sessionParamSchema = z.object({
  sessionId: z.string().uuid()
});

const runnerEventsQuerySchema = z.object({
  after_sequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const testRunSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000).optional(),
    workspacePath: z.string().trim().min(1).nullable().optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

const stopRunSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional()
  })
  .strict();

interface RunnerSessionRow {
  id: string;
  task_id: string | null;
  runner_id: string;
  hermes_run_id: string | null;
  conversation_id: string | null;
  workspace_path: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
  started_at: Date | string | null;
  finished_at: Date | string | null;
  last_event_at: Date | string | null;
  exit_code: number | null;
  error_summary: string | null;
  final_output: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RunnerEventRow {
  id: string;
  runner_session_id: string;
  task_id: string | null;
  source: "frank" | "hermes" | "system";
  event_type: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
  raw_event: Record<string, unknown> | null;
  sequence: number;
  created_at: Date | string;
}

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export function registerRunnerRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig) {
  server.get("/v1/runners", async () => {
    const hermes = await hermesStatus(config);
    return {
      runners: [
        {
          id: "hermes",
          type: "hermes",
          displayName: "Hermes Operator",
          status: runnerStatusFromHealth(hermes),
          configSummary: configSummary(config, hermes),
          health: hermes
        }
      ]
    };
  });

  server.get("/v1/runners/hermes/status", async () => {
    const status = await hermesStatus(config);
    return {
      runner: {
        id: "hermes",
        type: "hermes",
        displayName: "Hermes Operator",
        status: runnerStatusFromHealth(status),
        configSummary: configSummary(config, status)
      },
      status
    };
  });

  server.post("/v1/runners/hermes/install-check", async () => {
    const status = await hermesStatus(config);
    return {
      ok: status.health === "ok",
      status,
      setupHints: setupHints(status)
    };
  });

  server.get("/v1/runners/hermes/sessions/:id", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }

    const session = await findRunnerSession(pool, params.data.id);
    if (!session) {
      return reply.code(404).send({
        error: "runner_session_not_found",
        message: "Runner session not found."
      });
    }

    return { session: serializeRunnerSession(session) };
  });

  server.get("/v1/runners/hermes/sessions/:id/events", async (request, reply) => {
    const params = uuidParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const query = runnerEventsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const session = await findRunnerSession(pool, params.data.id);
    if (!session) {
      return reply.code(404).send({
        error: "runner_session_not_found",
        message: "Runner session not found."
      });
    }

    const events = await listRunnerEvents(pool, params.data.id, query.data.after_sequence, query.data.limit);
    const lastSequence = events.at(-1)?.sequence ?? query.data.after_sequence;
    return {
      events: events.map(serializeRunnerEvent),
      last_sequence: lastSequence,
      next_cursor: lastSequence
    };
  });

  server.post("/v1/runners/hermes/test-run", async (request, reply) => {
    const body = testRunSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const workspacePath = normalizeWorkspacePath(body.data.workspacePath ?? null, config.hermes.workspaceRoot);
    if (workspacePath.error) {
      return reply.code(400).send({
        error: "invalid_workspace",
        message: workspacePath.error
      });
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await ensureHermesRunner(client, config);
      const session = await createRunnerSession(client, {
        taskId: null,
        workspacePath: workspacePath.path,
        status: "starting",
        metadata: {
          testRun: true,
          requestedBy: actorId,
          ...(body.data.metadata ?? {})
        }
      });
      await insertRunnerEvent(client, {
        runnerSessionId: session.id,
        taskId: null,
        source: "frank",
        eventType: "runner.test_run.requested",
        severity: "info",
        message: "Frank requested a safe Hermes test run.",
        rawEvent: null
      });
      await recordAuditEvent(client, {
        actorType: "user",
        actorId,
        action: "runner.hermes.test_run",
        targetType: "runner_session",
        targetId: session.id,
        outcome: "success",
        metadata: {
          runnerId: "hermes"
        }
      });
      await client.query("commit");

      const adapter = createHermesRunnerAdapter(config.hermes);
      const started = await adapter.startRun({
        taskId: "runner-test",
        runnerSessionId: session.id,
        prompt:
          body.data.prompt ??
          "Hermes Frank Hub smoke test. Reply with a concise status line. Do not edit files.",
        workspacePath: workspacePath.path,
        metadata: {
          testRun: true
        }
      });

      const updated = await recordStartResult(pool, session.id, started);
      return reply.code(started.status === "running" ? 202 : 200).send({
        session: serializeRunnerSession(updated),
        startResult: started
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  server.post("/v1/runners/hermes/stop/:sessionId", async (request, reply) => {
    const params = sessionParamSchema.safeParse(request.params);
    if (!params.success) {
      return sendValidationError(reply, params.error);
    }
    const body = stopRunSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const actorId = getRequestActorId(request);
    const session = await findRunnerSession(pool, params.data.sessionId);
    if (!session) {
      return reply.code(404).send({
        error: "runner_session_not_found",
        message: "Runner session not found."
      });
    }

    const reason = body.data.reason ?? "Stop requested from Frank Hub.";
    await markSessionStopping(pool, session, actorId, reason);

    const adapter = createHermesRunnerAdapter(config.hermes);
    const stopResult = await adapter.stopRun({
      runnerSessionId: session.id,
      hermesRunId: session.hermes_run_id,
      reason
    });

    const updated = await recordStopResult(pool, session, stopResult, actorId, reason);
    return {
      session: serializeRunnerSession(updated),
      stopResult
    };
  });
}

async function hermesStatus(config: ApiConfig): Promise<HermesHealthResult> {
  const adapter = createHermesRunnerAdapter(config.hermes);
  return adapter.health();
}

function runnerStatusFromHealth(status: HermesHealthResult): "disabled" | "not_configured" | "available" | "unavailable" {
  if (!status.enabled) {
    return "disabled";
  }
  if (!status.configured) {
    return "not_configured";
  }
  return status.health === "ok" ? "available" : "unavailable";
}

function configSummary(config: ApiConfig, status: HermesHealthResult): Record<string, unknown> {
  return {
    enabled: status.enabled,
    configured: status.configured,
    reachable: status.reachable,
    apiBaseUrl: config.hermes.apiBaseUrl,
    apiKeyConfigured: Boolean(config.hermes.apiServerKey),
    workspaceRoot: config.hermes.workspaceRoot,
    artifactRoot: config.hermes.artifactRoot,
    timeoutSeconds: config.hermes.timeoutSeconds,
    stallTimeoutSeconds: config.hermes.stallTimeoutSeconds,
    eventsPollMs: config.hermes.eventsPollMs
  };
}

function setupHints(status: HermesHealthResult): string[] {
  if (!status.enabled) {
    return ["Set HERMES_ENABLED=true after Hermes has been configured on the private Compose network."];
  }
  if (!status.configured) {
    return ["Set HERMES_API_SERVER_KEY in .env. The key is required before Frank will use Hermes."];
  }
  if (!status.reachable) {
    return ["Start the private Hermes gateway with scripts/hermes_compose_up.sh and run scripts/hermes_check.sh."];
  }
  return ["Hermes is reachable through the private Frank API/worker path."];
}

async function ensureHermesRunner(db: Queryable, config: ApiConfig): Promise<void> {
  const health = await hermesStatus(config);
  await db.query(
    `
      insert into runners (id, type, display_name, status, config_summary)
      values ('hermes', 'hermes', 'Hermes Operator', $1, $2::jsonb)
      on conflict (id) do update
      set
        status = excluded.status,
        config_summary = excluded.config_summary,
        updated_at = now()
    `,
    [runnerStatusFromHealth(health), JSON.stringify(configSummary(config, health))]
  );
}

async function createRunnerSession(
  db: Queryable,
  input: {
    taskId: string | null;
    workspacePath: string | null;
    status: RunnerSessionRow["status"];
    metadata: Record<string, unknown>;
  }
): Promise<RunnerSessionRow> {
  const result = await db.query<RunnerSessionRow>(
    `
      insert into runner_sessions (
        task_id,
        runner_id,
        workspace_path,
        status,
        metadata
      )
      values ($1, 'hermes', $2, $3, $4::jsonb)
      returning ${runnerSessionSelectColumns}
    `,
    [input.taskId, input.workspacePath, input.status, JSON.stringify(redactRecord(input.metadata))]
  );
  const session = result.rows[0];
  if (!session) {
    throw new Error("Runner session insert did not return a row.");
  }
  return session;
}

async function recordStartResult(
  db: Queryable,
  sessionId: string,
  started: { hermesRunId: string | null; conversationId: string | null; status: "running" | "failed" | "blocked"; message: string | null }
): Promise<RunnerSessionRow> {
  const nextStatus = started.status === "running" ? "running" : started.status;
  const eventSeverity = started.status === "running" ? "success" : "error";
  const eventType = started.status === "running" ? "runner.hermes.started" : "runner.hermes.start_failed";
  const client = "connect" in db ? await (db as PgPool).connect() : null;
  const queryable = client ?? db;

  try {
    await queryable.query("begin");
    const updated = await queryable.query<RunnerSessionRow>(
      `
        update runner_sessions
        set
          hermes_run_id = $2,
          conversation_id = $3,
          status = $4,
          started_at = case when $4 = 'running' then now() else started_at end,
          finished_at = case when $4 in ('failed', 'blocked') then now() else finished_at end,
          error_summary = $5,
          updated_at = now()
        where id = $1
        returning ${runnerSessionSelectColumns}
      `,
      [sessionId, started.hermesRunId, started.conversationId, nextStatus, started.message]
    );
    const session = updated.rows[0];
    if (!session) {
      throw new Error("Runner session update did not return a row.");
    }
    await insertRunnerEvent(queryable, {
      runnerSessionId: session.id,
      taskId: session.task_id,
      source: started.status === "running" ? "hermes" : "system",
      eventType,
      severity: eventSeverity,
      message: started.message ?? "Hermes run started.",
      rawEvent: {
        hermesRunId: started.hermesRunId,
        status: started.status
      }
    });
    await queryable.query("commit");
    return session;
  } catch (error) {
    await queryable.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client?.release();
  }
}

async function markSessionStopping(
  pool: PgPool,
  session: RunnerSessionRow,
  actorId: string,
  reason: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        update runner_sessions
        set status = 'stopping', updated_at = now()
        where id = $1
          and status in ('queued', 'starting', 'running')
      `,
      [session.id]
    );
    await client.query(
      `
        insert into runner_stop_requests (
          runner_session_id,
          task_id,
          requested_by,
          reason,
          status
        )
        values ($1, $2, $3, $4, 'requested')
      `,
      [session.id, session.task_id, actorId, redactSecrets(reason)]
    );
    await insertRunnerEvent(client, {
      runnerSessionId: session.id,
      taskId: session.task_id,
      source: "frank",
      eventType: "runner.stop.requested",
      severity: "warning",
      message: "Stop requested for Hermes runner session.",
      rawEvent: {
        requestedBy: actorId,
        reason
      }
    });
    await recordAuditEvent(client, {
      actorType: "user",
      actorId,
      action: "runner.hermes.stop_request",
      targetType: "runner_session",
      targetId: session.id,
      outcome: "success",
      metadata: {
        taskId: session.task_id
      }
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function recordStopResult(
  pool: PgPool,
  session: RunnerSessionRow,
  stopResult: { stopped: boolean; method: string; message: string },
  actorId: string,
  reason: string
): Promise<RunnerSessionRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const terminalStatus = stopResult.stopped ? "cancelled" : "failed";
    const updated = await client.query<RunnerSessionRow>(
      `
        update runner_sessions
        set
          status = $2,
          finished_at = now(),
          error_summary = $3,
          updated_at = now()
        where id = $1
        returning ${runnerSessionSelectColumns}
      `,
      [session.id, terminalStatus, stopResult.message]
    );
    await client.query(
      `
        update runner_stop_requests
        set
          status = $2,
          method = $3,
          updated_at = now()
        where runner_session_id = $1
          and status in ('requested', 'attempted')
      `,
      [session.id, stopResult.stopped ? "succeeded" : "failed", stopResult.method]
    );
    await insertRunnerEvent(client, {
      runnerSessionId: session.id,
      taskId: session.task_id,
      source: "system",
      eventType: stopResult.stopped ? "runner.stop.succeeded" : "runner.stop.failed",
      severity: stopResult.stopped ? "success" : "error",
      message: stopResult.message,
      rawEvent: {
        method: stopResult.method,
        reason
      }
    });
    await recordAuditEvent(client, {
      actorType: "user",
      actorId,
      action: stopResult.stopped ? "runner.hermes.stop_success" : "runner.hermes.stop_failure",
      targetType: "runner_session",
      targetId: session.id,
      outcome: stopResult.stopped ? "success" : "failure",
      metadata: {
        method: stopResult.method,
        taskId: session.task_id
      }
    });
    await client.query("commit");
    const finalSession = updated.rows[0];
    if (!finalSession) {
      throw new Error("Runner session stop update did not return a row.");
    }
    return finalSession;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function findRunnerSession(db: Queryable, id: string): Promise<RunnerSessionRow | undefined> {
  const result = await db.query<RunnerSessionRow>(
    `
      select ${runnerSessionSelectColumns}
      from runner_sessions
      where id = $1
    `,
    [id]
  );
  return result.rows[0];
}

async function listRunnerEvents(
  db: Queryable,
  runnerSessionId: string,
  afterSequence: number,
  limit: number
): Promise<RunnerEventRow[]> {
  const result = await db.query<RunnerEventRow>(
    `
      select ${runnerEventSelectColumns}
      from runner_events
      where runner_session_id = $1
        and sequence > $2
      order by sequence asc
      limit $3
    `,
    [runnerSessionId, afterSequence, limit]
  );
  return result.rows;
}

export async function insertRunnerEvent(db: Queryable, event: {
  runnerSessionId: string;
  taskId: string | null;
  source: RunnerEvent["source"];
  eventType: string;
  severity: RunnerEvent["severity"];
  message: string;
  rawEvent: Record<string, unknown> | null;
}): Promise<RunnerEventRow> {
  const result = await db.query<RunnerEventRow>(
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
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        coalesce((select max(sequence) + 1 from runner_events where runner_session_id = $1), 1)
      )
      returning ${runnerEventSelectColumns}
    `,
    [
      event.runnerSessionId,
      event.taskId,
      event.source,
      event.eventType,
      event.severity,
      redactSecrets(event.message),
      JSON.stringify(event.rawEvent ? redactRecord(event.rawEvent) : null)
    ]
  );
  const inserted = result.rows[0];
  if (!inserted) {
    throw new Error("Runner event insert did not return a row.");
  }
  return inserted;
}

const runnerSessionSelectColumns = `
  id,
  task_id,
  runner_id,
  hermes_run_id,
  conversation_id,
  workspace_path,
  status,
  started_at,
  finished_at,
  last_event_at,
  exit_code,
  error_summary,
  final_output,
  metadata,
  created_at,
  updated_at
`;

const runnerEventSelectColumns = `
  id,
  runner_session_id,
  task_id,
  source,
  event_type,
  severity,
  message,
  raw_event,
  sequence,
  created_at
`;

function serializeRunnerSession(row: RunnerSessionRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    runnerId: row.runner_id,
    hermesRunId: row.hermes_run_id,
    conversationId: row.conversation_id,
    workspacePath: row.workspace_path,
    status: row.status,
    startedAt: serializeTimestamp(row.started_at),
    finishedAt: serializeTimestamp(row.finished_at),
    lastEventAt: serializeTimestamp(row.last_event_at),
    exitCode: row.exit_code,
    errorSummary: row.error_summary,
    finalOutput: row.final_output,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function serializeRunnerEvent(row: RunnerEventRow) {
  return {
    id: row.id,
    runnerSessionId: row.runner_session_id,
    taskId: row.task_id,
    source: row.source,
    eventType: row.event_type,
    severity: row.severity,
    message: row.message,
    rawEvent: row.raw_event,
    sequence: row.sequence,
    createdAt: serializeTimestamp(row.created_at)
  };
}

function normalizeWorkspacePath(
  requestedPath: string | null,
  defaultWorkspaceRoot: string
): { path: string | null; error: string | null } {
  const workspacePath = requestedPath ?? `${defaultWorkspaceRoot.replace(/\/$/, "")}/tasks/runner-test`;
  if (workspacePath === "/" || workspacePath === "/root") {
    return {
      path: null,
      error: "Hermes workspace cannot be / or /root."
    };
  }
  return {
    path: workspacePath,
    error: null
  };
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactSecrets(JSON.stringify(value))) as Record<string, unknown>;
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

function serializeTimestamp(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}
