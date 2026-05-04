import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHermesRunnerAdapter, type HermesRunnerConfig, type RunnerEvent } from "@frank/hermes-runner";
import { z } from "zod";
import type { TaskWorkerContext, WorkerPool, WorkerQueryable } from "./task-worker.js";

const hermesEnvSchema = z.object({
  HERMES_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
  HERMES_API_BASE_URL: z.string().url().default("http://hermes:8642"),
  HERMES_API_SERVER_KEY: z.string().optional(),
  HERMES_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  HERMES_STALL_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  HERMES_EVENTS_POLL_MS: z.coerce.number().int().positive().default(1000),
  HERMES_WORKSPACE_ROOT: z.string().default("/opt/frank-hub/workspaces"),
  HERMES_ARTIFACT_ROOT: z.string().default("/opt/frank-hub/runtime/artifacts")
});

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
}

interface RunnerSessionRow {
  id: string;
  task_id: string | null;
  hermes_run_id: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
  workspace_path: string | null;
  metadata: Record<string, unknown>;
}

export function loadHermesWorkerConfig(env: NodeJS.ProcessEnv = process.env): HermesRunnerConfig {
  const parsed = hermesEnvSchema.parse(env);
  return {
    enabled: parsed.HERMES_ENABLED,
    apiBaseUrl: parsed.HERMES_API_BASE_URL.replace(/\/$/, ""),
    apiServerKey: parsed.HERMES_API_SERVER_KEY?.trim() || undefined,
    timeoutSeconds: parsed.HERMES_TIMEOUT_SECONDS,
    stallTimeoutSeconds: parsed.HERMES_STALL_TIMEOUT_SECONDS,
    eventsPollMs: parsed.HERMES_EVENTS_POLL_MS,
    workspaceRoot: parsed.HERMES_WORKSPACE_ROOT,
    artifactRoot: parsed.HERMES_ARTIFACT_ROOT
  };
}

export function createHermesExecutionHandler(pool: WorkerPool, config: HermesRunnerConfig) {
  const adapter = createHermesRunnerAdapter(config);

  return async function runHermesTask(context: TaskWorkerContext): Promise<void> {
    const task = await findTask(pool, context.taskId);
    if (!task) {
      throw new Error("Hermes task was not found.");
    }

    const session = await findOrCreateRunnerSession(pool, task.id, config);
    const selfUpgradeRunId = stringMetadata(task.metadata.selfUpgradeRunId);
    const workspacePath = session.workspace_path ?? taskWorkspacePath(config.workspaceRoot, task.id);
    const prompt = buildHermesPrompt({
      task,
      workspacePath,
      projectContext: projectContext(task)
    });

    await markRunnerSessionStarting(pool, session.id, workspacePath, {
      workerId: context.workerId,
      agentSessionId: context.sessionId,
      attempt: context.attempt
    });
    await markSelfUpgradeRun(pool, selfUpgradeRunId, "running", session.id);

    const started = await adapter.startRun({
      taskId: task.id,
      runnerSessionId: session.id,
      prompt,
      workspacePath,
      metadata: {
        workerId: context.workerId,
        agentSessionId: context.sessionId,
        attempt: context.attempt
      }
    });

    if (started.status !== "running" || !started.hermesRunId) {
      await markRunnerSessionTerminal(pool, session.id, started.status === "blocked" ? "blocked" : "failed", {
        errorSummary: started.message ?? "Hermes did not start.",
        finalOutput: null
      });
      await markSelfUpgradeRun(pool, selfUpgradeRunId, "failed", session.id);
      throw new Error(started.message ?? "Hermes did not start.");
    }

    await markRunnerSessionRunning(pool, session.id, started.hermesRunId, started.conversationId);
    await appendRunnerAndTaskEvent(pool, task.id, session.id, {
      source: "hermes",
      eventType: "runner.hermes.started",
      severity: "success",
      message: "Hermes run started.",
      rawEvent: {
        hermesRunId: started.hermesRunId
      }
    });

    let finalOutput = "";
    let failedMessage: string | null = null;

    for await (const event of adapter.streamEvents({ runnerSessionId: session.id, hermesRunId: started.hermesRunId })) {
      await appendRunnerAndTaskEvent(pool, task.id, session.id, event);

      if (event.eventType === "message.delta") {
        finalOutput += event.message;
      }
      if (event.eventType === "run.completed") {
        finalOutput = event.message || finalOutput;
      }
      if (event.eventType === "run.failed") {
        failedMessage = event.message;
      }
    }

    if (failedMessage) {
      await markRunnerSessionTerminal(pool, session.id, "failed", {
        errorSummary: failedMessage,
        finalOutput: finalOutput || null
      });
      await markSelfUpgradeRun(pool, selfUpgradeRunId, "failed", session.id);
      throw new Error(failedMessage);
    }

    await markRunnerSessionTerminal(pool, session.id, "completed", {
      errorSummary: null,
      finalOutput: finalOutput || "Hermes completed without a final text response."
    });
    await markSelfUpgradeRun(pool, selfUpgradeRunId, selfUpgradeTerminalStatus(task.metadata), session.id);
    await persistFinalOutputArtifact(pool, config, task.id, session.id, finalOutput || "Hermes completed without a final text response.");
  };
}

export function buildHermesPrompt(input: {
  task: Pick<TaskRow, "title" | "description">;
  workspacePath: string;
  projectContext: string;
}): string {
  return `You are Hermes running as Frank Hub's high-trust VPS operator.

Task:
${input.task.title}

Instructions:
${input.task.description ?? "No additional instructions were provided."}

Operating mode:
- High-trust VPS operator
- You may inspect files, edit files, run commands, install packages, run tests, use Git, and use available tools.
- Log important commands/actions.
- Avoid unrecoverable destructive actions without asking.
- Do not expose secrets publicly.
- Do not delete production data unless explicitly requested.
- Before high-risk changes, create or request a backup.
- Return a final concise report with:
  - what you changed
  - commands run
  - files changed
  - tests run
  - result
  - follow-up needed

Workspace:
${input.workspacePath}

Context:
${input.projectContext}

Return final status:
completed / failed / blocked / needs_approval`;
}

async function findTask(pool: WorkerPool, taskId: string): Promise<TaskRow | undefined> {
  const result = await pool.query<TaskRow>(
    `
      select id, title, description, metadata
      from tasks
      where id = $1
    `,
    [taskId]
  );
  return result.rows[0];
}

async function findOrCreateRunnerSession(
  pool: WorkerPool,
  taskId: string,
  config: HermesRunnerConfig
): Promise<RunnerSessionRow> {
  const existing = await pool.query<RunnerSessionRow>(
    `
      select id, task_id, hermes_run_id, status, workspace_path, metadata
      from runner_sessions
      where task_id = $1
        and runner_id = 'hermes'
        and status in ('queued', 'starting', 'running', 'stopping')
      order by created_at desc
      limit 1
    `,
    [taskId]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await pool.query<RunnerSessionRow>(
    `
      insert into runner_sessions (
        task_id,
        runner_id,
        workspace_path,
        status,
        metadata
      )
      values ($1, 'hermes', $2, 'queued', '{}'::jsonb)
      returning id, task_id, hermes_run_id, status, workspace_path, metadata
    `,
    [taskId, taskWorkspacePath(config.workspaceRoot, taskId)]
  );
  const session = created.rows[0];
  if (!session) {
    throw new Error("Hermes runner session insert did not return a row.");
  }
  return session;
}

async function markRunnerSessionStarting(
  pool: WorkerPool,
  sessionId: string,
  workspacePath: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `
      update runner_sessions
      set
        status = 'starting',
        workspace_path = $2,
        metadata = metadata || $3::jsonb,
        updated_at = now()
      where id = $1
    `,
    [sessionId, workspacePath, JSON.stringify(metadata)]
  );
}

async function markRunnerSessionRunning(
  pool: WorkerPool,
  sessionId: string,
  hermesRunId: string,
  conversationId: string | null
): Promise<void> {
  await pool.query(
    `
      update runner_sessions
      set
        status = 'running',
        hermes_run_id = $2,
        conversation_id = $3,
        started_at = coalesce(started_at, now()),
        updated_at = now()
      where id = $1
    `,
    [sessionId, hermesRunId, conversationId]
  );
}

async function markRunnerSessionTerminal(
  pool: WorkerPool,
  sessionId: string,
  status: "completed" | "failed" | "cancelled" | "blocked",
  result: { errorSummary: string | null; finalOutput: string | null }
): Promise<void> {
  await pool.query(
    `
      update runner_sessions
      set
        status = $2,
        finished_at = now(),
        error_summary = $3,
        final_output = $4,
        updated_at = now()
      where id = $1
    `,
    [sessionId, status, result.errorSummary, result.finalOutput]
  );
}

async function markSelfUpgradeRun(
  pool: WorkerPool,
  selfUpgradeRunId: string | null,
  status: "running" | "completed" | "failed" | "rolled_back",
  runnerSessionId: string
): Promise<void> {
  if (!selfUpgradeRunId) {
    return;
  }
  await pool.query(
    `
      update self_upgrade_runs
      set
        status = $2,
        runner_session_id = $3,
        finished_at = case when $2 in ('completed', 'failed', 'cancelled', 'rolled_back') then now() else finished_at end,
        updated_at = now()
      where id = $1
    `,
    [selfUpgradeRunId, status, runnerSessionId]
  );
}

async function persistFinalOutputArtifact(
  pool: WorkerPool,
  config: HermesRunnerConfig,
  taskId: string,
  runnerSessionId: string,
  finalOutput: string
): Promise<void> {
  const artifactId = randomUUID();
  const artifactDir = path.join(config.artifactRoot, taskId);
  const artifactPath = path.join(artifactDir, `${artifactId}.md`);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, finalOutput, "utf8");
  await pool.query(
    `
      insert into runner_artifacts (
        id,
        task_id,
        runner_session_id,
        artifact_type,
        name,
        storage_path,
        content_type,
        size_bytes,
        metadata
      )
      values ($1, $2, $3, 'final_report', 'Hermes final report', $4, 'text/markdown; charset=utf-8', $5, $6::jsonb)
    `,
    [
      artifactId,
      taskId,
      runnerSessionId,
      artifactPath,
      Buffer.byteLength(finalOutput, "utf8"),
      JSON.stringify({
        generatedBy: "hermes_operator",
        source: "final_output"
      })
    ]
  );
}

async function appendRunnerAndTaskEvent(
  pool: WorkerPool,
  taskId: string,
  runnerSessionId: string,
  event: RunnerEvent
): Promise<void> {
  await insertRunnerEvent(pool, taskId, runnerSessionId, event);
  await insertTaskEvent(pool, taskId, event);
}

async function insertRunnerEvent(
  pool: WorkerPool,
  taskId: string,
  runnerSessionId: string,
  event: RunnerEvent
): Promise<void> {
  await pool.query(
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
    `,
    [
      runnerSessionId,
      taskId,
      event.source,
      event.eventType,
      event.severity,
      event.message,
      JSON.stringify(event.rawEvent)
    ]
  );
  await pool.query("update runner_sessions set last_event_at = now(), updated_at = now() where id = $1", [
    runnerSessionId
  ]);
}

async function insertTaskEvent(pool: WorkerQueryable, taskId: string, event: RunnerEvent): Promise<void> {
  await pool.query(
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
      values ($1, $2, 'worker', 'hermes', null, null, $3, $4, $5::jsonb)
    `,
    [
      taskId,
      `hermes.${event.eventType}`,
      taskSeverity(event.severity),
      event.message,
      JSON.stringify({
        runnerSource: event.source,
        rawEvent: event.rawEvent
      })
    ]
  );
}

function taskWorkspacePath(workspaceRoot: string, taskId: string): string {
  return `${workspaceRoot.replace(/\/$/, "")}/tasks/${taskId}`;
}

function projectContext(task: TaskRow): string {
  return [
    "Frank Hub is a private dashboard-first control plane.",
    "Frank owns task state, runner events, artifacts, backups, and audit history.",
    "Hermes owns execution, terminal/file/web tools, memory, skills, and subagents.",
    `Task metadata: ${JSON.stringify(task.metadata ?? {})}`
  ].join("\n");
}

function stringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function selfUpgradeTerminalStatus(metadata: Record<string, unknown>): "completed" | "rolled_back" {
  return metadata.kind === "self_upgrade_rollback" ? "rolled_back" : "completed";
}

function taskSeverity(severity: RunnerEvent["severity"]): "debug" | "info" | "warn" | "error" {
  if (severity === "warning") {
    return "warn";
  }
  if (severity === "error") {
    return "error";
  }
  return "info";
}

function booleanFromEnv(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
