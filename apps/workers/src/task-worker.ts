import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { z } from "zod";

const allowedExecutionKinds = ["manual_lifecycle", "hermes_operator"] as const;
const maxSafeStringLength = 500;
const maxExpiredLeasesPerTick = 10;

const workerEnvSchema = z.object({
  WORKER_ID: z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional()),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(1).refine((value) => value === 1, {
    message: "WORKER_BATCH_SIZE must be 1 for the Stage 3 task-worker-core foundation."
  })
});

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface WorkerQueryable {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

export interface WorkerClient extends WorkerQueryable {
  release(): void;
}

export interface WorkerPool extends WorkerQueryable {
  connect(): Promise<WorkerClient>;
}

export interface TaskWorkerConfig {
  workerId: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  batchSize: 1;
}

export interface TaskWorkerContext {
  taskId: string;
  agentId: string;
  sessionId: string;
  workerId: string;
  attempt: number;
  executionKind: string;
}

export interface RunWorkerTickOptions {
  manualLifecycleExecutor?: (context: TaskWorkerContext) => Promise<void>;
  executionHandlers?: Record<string, (context: TaskWorkerContext) => Promise<void>>;
}

export interface RunWorkerTickResult {
  expiredLeases: number;
  claim:
    | { status: "none" }
    | { status: "blocked"; taskId: string; reasonCode: string }
    | { status: "completed"; taskId: string; sessionId: string }
    | { status: "failed"; taskId: string; sessionId: string };
}

export interface RunningTaskWorker {
  stop(): Promise<void>;
}

interface TaskRow {
  id: string;
  state: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled" | "draft" | "waiting_approval";
  execution_kind: string | null;
  assigned_agent_id: string | null;
  priority: number;
  attempt_count: number;
  created_at: Date | string;
  queued_at: Date | string | null;
}

interface AgentRow {
  id: string;
  status: "available" | "disabled" | "planned";
  metadata: Record<string, unknown>;
}

interface AgentSessionRow {
  id: string;
  task_id: string | null;
  agent_id: string;
  status: "running" | "blocked" | "completed" | "failed" | "cancelled" | "idle";
  attempt: number;
  lease_token: string | null;
}

interface StaleLeaseRow {
  session_id: string;
  task_id: string;
  agent_id: string;
  task_state: TaskRow["state"];
  lease_expires_at: Date | string;
}

interface BlockReason {
  code:
    | "missing_execution_kind"
    | "unsupported_execution_kind"
    | "agent_unassigned"
    | "agent_not_found"
    | "agent_unavailable"
    | "agent_runtime_disabled";
  message: string;
}

interface ClaimedTask {
  taskId: string;
  agentId: string;
  sessionId: string;
  leaseToken: string;
  attempt: number;
  executionKind: string;
}

type ClaimNextTaskResult =
  | { status: "none" }
  | { status: "blocked"; taskId: string; reasonCode: BlockReason["code"] }
  | { status: "claimed"; claimed: ClaimedTask };

export function loadTaskWorkerConfig(env: NodeJS.ProcessEnv = process.env): TaskWorkerConfig {
  const parsed = workerEnvSchema.parse(env);
  return {
    workerId: parsed.WORKER_ID ?? defaultWorkerId(),
    pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    leaseSeconds: parsed.WORKER_LEASE_SECONDS,
    batchSize: 1
  };
}

export async function runWorkerTick(
  pool: WorkerPool,
  config: TaskWorkerConfig,
  options: RunWorkerTickOptions = {}
): Promise<RunWorkerTickResult> {
  const expiredLeases = await expireStaleLeases(pool, config);
  const claim = await claimNextTask(pool, config);

  if (claim.status !== "claimed") {
    return {
      expiredLeases,
      claim: claim.status === "blocked" && claim.taskId && claim.reasonCode
        ? { status: "blocked", taskId: claim.taskId, reasonCode: claim.reasonCode }
        : { status: "none" }
    };
  }

  const processed = await processClaimedTask(pool, config, claim.claimed, options);
  return {
    expiredLeases,
    claim: processed
  };
}

export async function claimNextTask(pool: WorkerPool, config: TaskWorkerConfig): Promise<ClaimNextTaskResult> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const task = await selectNextQueuedTask(client);

    if (!task) {
      await client.query("commit");
      return { status: "none" };
    }

    const blockReason = await getBlockReason(client, task);
    if (blockReason) {
      await blockTask(client, task, config, blockReason);
      await client.query("commit");
      return {
        status: "blocked",
        taskId: task.id,
        reasonCode: blockReason.code
      };
    }

    const claimed = await createTaskLease(client, task, config);
    await client.query("commit");
    return {
      status: "claimed",
      claimed
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function processClaimedTask(
  pool: WorkerPool,
  config: TaskWorkerConfig,
  claimed: ClaimedTask,
  options: RunWorkerTickOptions = {}
): Promise<RunWorkerTickResult["claim"]> {
  try {
    await startClaimedTask(pool, config, claimed);
    const executor =
      claimed.executionKind === "manual_lifecycle"
        ? options.manualLifecycleExecutor ?? defaultManualLifecycleExecutor
        : options.executionHandlers?.[claimed.executionKind];
    if (!executor) {
      throw new Error(`No worker executor registered for execution_kind ${claimed.executionKind}.`);
    }

    await executor({
      taskId: claimed.taskId,
      agentId: claimed.agentId,
      sessionId: claimed.sessionId,
      workerId: config.workerId,
      attempt: claimed.attempt,
      executionKind: claimed.executionKind
    });
    await completeClaimedTask(pool, config, claimed);
    return {
      status: "completed",
      taskId: claimed.taskId,
      sessionId: claimed.sessionId
    };
  } catch (error) {
    await failClaimedTask(pool, config, claimed, error);
    return {
      status: "failed",
      taskId: claimed.taskId,
      sessionId: claimed.sessionId
    };
  }
}

export async function expireStaleLeases(pool: WorkerPool, config: TaskWorkerConfig): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const staleLeases = await client.query<StaleLeaseRow>(
      `
        select
          s.id as session_id,
          s.task_id,
          s.agent_id,
          t.state as task_state,
          s.lease_expires_at
        from agent_sessions s
        join tasks t on t.id = s.task_id
        where s.status = 'running'
          and s.ended_at is null
          and s.lease_expires_at is not null
          and s.lease_expires_at < now()
          and t.state in ('queued', 'running')
        order by s.lease_expires_at asc
        for update of s, t skip locked
        limit $1
      `,
      [maxExpiredLeasesPerTick]
    );

    for (const lease of staleLeases.rows) {
      await client.query(
        `
          update tasks
          set
            state = 'failed',
            finished_at = now(),
            last_error = $2,
            updated_at = now()
          where id = $1
            and state in ('queued', 'running')
        `,
        [lease.task_id, "Worker lease expired before task completed."]
      );

      await client.query(
        `
          update agent_sessions
          set
            status = 'failed',
            ended_at = now(),
            heartbeat_at = now(),
            metadata = metadata || $2::jsonb
          where id = $1
        `,
        [
          lease.session_id,
          JSON.stringify({
            endedBy: "lease_expiry",
            workerId: config.workerId
          })
        ]
      );

      const metadata = safeMetadata({
        workerId: config.workerId,
        sessionId: lease.session_id,
        agentId: lease.agent_id,
        reasonCode: "lease_expired"
      });

      await insertTaskEvent(client, {
        taskId: lease.task_id,
        eventType: "worker.lease_expired",
        workerId: config.workerId,
        fromState: lease.task_state,
        toState: "failed",
        severity: "error",
        message: "Worker lease expired before task completed.",
        metadata
      });

      await recordWorkerAudit(client, {
        workerId: config.workerId,
        action: "worker.lease_expired",
        taskId: lease.task_id,
        outcome: "failure",
        metadata
      });
    }

    await client.query("commit");
    return staleLeases.rows.length;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function startTaskWorker(
  pool: WorkerPool,
  config: TaskWorkerConfig,
  options: RunWorkerTickOptions & { logger?: Pick<Console, "error" | "log"> } = {}
): RunningTaskWorker {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let activeTick: Promise<void> | undefined;
  const logger = options.logger ?? console;

  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(runTick, config.pollIntervalMs);
  };

  const runTick = () => {
    if (stopped || activeTick) {
      schedule();
      return;
    }

    activeTick = runWorkerTick(pool, config, options)
      .then((result) => {
        if (result.expiredLeases > 0 || result.claim.status !== "none") {
          logger.log("Frank task worker tick", safeMetadata(result));
        }
      })
      .catch((error) => {
        logger.error("Frank task worker tick failed", sanitizeError(error));
      })
      .finally(() => {
        activeTick = undefined;
        schedule();
      });
  };

  timer = setTimeout(runTick, 0);

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      await activeTick?.catch(() => undefined);
    }
  };
}

async function selectNextQueuedTask(client: WorkerClient): Promise<TaskRow | undefined> {
  const result = await client.query<TaskRow>(
    `
      select
        t.id,
        t.state,
        t.execution_kind,
        t.assigned_agent_id,
        t.priority,
        t.attempt_count,
        t.created_at,
        t.queued_at
      from tasks t
      where t.state = 'queued'
        and not exists (
          select 1
          from agent_sessions active
          where active.task_id = t.id
            and active.status = 'running'
            and active.ended_at is null
        )
      order by t.priority asc, t.queued_at asc nulls last, t.created_at asc
      for update of t skip locked
      limit 1
    `
  );

  return result.rows[0];
}

async function getBlockReason(client: WorkerClient, task: TaskRow): Promise<BlockReason | undefined> {
  if (!task.execution_kind) {
    return {
      code: "missing_execution_kind",
      message: "Task blocked because execution_kind is missing."
    };
  }

  if (!allowedExecutionKinds.includes(task.execution_kind as (typeof allowedExecutionKinds)[number])) {
    return {
      code: "unsupported_execution_kind",
      message: "Task blocked because execution_kind is not supported by the worker."
    };
  }

  if (!task.assigned_agent_id) {
    return {
      code: "agent_unassigned",
      message: "Task blocked because no agent is assigned."
    };
  }

  const agent = await client.query<AgentRow>(
    `
      select
        id,
        status,
        metadata
      from agents
      where id = $1
    `,
    [task.assigned_agent_id]
  );
  const assignedAgent = agent.rows[0];

  if (!assignedAgent) {
    return {
      code: "agent_not_found",
      message: "Task blocked because the assigned agent was not found."
    };
  }

  if (assignedAgent.status !== "available") {
    return {
      code: "agent_unavailable",
      message: "Task blocked because the assigned agent is not available."
    };
  }

  if (assignedAgent.metadata.runtime === "disabled") {
    return {
      code: "agent_runtime_disabled",
      message: "Task blocked because the assigned agent runtime is disabled."
    };
  }

  return undefined;
}

async function createTaskLease(client: WorkerClient, task: TaskRow, config: TaskWorkerConfig): Promise<ClaimedTask> {
  if (!task.assigned_agent_id) {
    throw new Error("Cannot create a task lease without an assigned agent.");
  }

  const attempt = task.attempt_count + 1;
  const leaseToken = randomUUID();
  const session = await client.query<AgentSessionRow>(
    `
      insert into agent_sessions (
        agent_id,
        task_id,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        heartbeat_at,
        attempt,
        metadata
      )
      values (
        $1,
        $2,
        'running',
        $3,
        $4,
        now() + ($5::text || ' seconds')::interval,
        now(),
        $6,
        $7::jsonb
      )
      returning id, task_id, agent_id, status, attempt, lease_token
    `,
    [
      task.assigned_agent_id,
      task.id,
      config.workerId,
      leaseToken,
      config.leaseSeconds,
      attempt,
      JSON.stringify({
        stage: 3,
        workstream: "task-worker-core"
      })
    ]
  );
  const createdSession = session.rows[0];
  if (!createdSession) {
    throw new Error("Agent session insert did not return a row.");
  }

  await client.query(
    `
      update tasks
      set
        attempt_count = $2,
        queued_at = coalesce(queued_at, now()),
        updated_at = now()
      where id = $1
    `,
    [task.id, attempt]
  );

  const metadata = safeMetadata({
    workerId: config.workerId,
    sessionId: createdSession.id,
    agentId: task.assigned_agent_id,
    executionKind: task.execution_kind,
    attempt
  });

  await insertTaskEvent(client, {
    taskId: task.id,
    eventType: "worker.task.claimed",
    workerId: config.workerId,
    fromState: "queued",
    toState: "queued",
    severity: "info",
    message: "Worker claimed queued task.",
    metadata
  });

  await recordWorkerAudit(client, {
    workerId: config.workerId,
    action: "worker.task.claim",
    taskId: task.id,
    outcome: "success",
    metadata
  });

  return {
    taskId: task.id,
    agentId: task.assigned_agent_id,
    sessionId: createdSession.id,
    leaseToken,
    attempt,
    executionKind: task.execution_kind ?? "manual_lifecycle"
  };
}

async function blockTask(client: WorkerClient, task: TaskRow, config: TaskWorkerConfig, reason: BlockReason): Promise<void> {
  await client.query(
    `
      update tasks
      set
        state = 'blocked',
        finished_at = now(),
        last_error = $2,
        updated_at = now()
      where id = $1
        and state = 'queued'
    `,
    [task.id, reason.message]
  );

  const metadata = safeMetadata({
    workerId: config.workerId,
    reasonCode: reason.code,
    executionKind: task.execution_kind,
    assignedAgentId: task.assigned_agent_id
  });

  await insertTaskEvent(client, {
    taskId: task.id,
    eventType: "worker.task.blocked",
    workerId: config.workerId,
    fromState: "queued",
    toState: "blocked",
    severity: "warn",
    message: reason.message,
    metadata
  });

  await recordWorkerAudit(client, {
    workerId: config.workerId,
    action: "worker.task.block",
    taskId: task.id,
    outcome: "success",
    metadata
  });
}

async function startClaimedTask(pool: WorkerPool, config: TaskWorkerConfig, claimed: ClaimedTask): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const task = await selectTaskForUpdate(client, claimed.taskId);
    if (!task || task.state !== "queued") {
      throw new Error("Claimed task is no longer queued.");
    }

    const session = await selectSessionForUpdate(client, claimed.sessionId, claimed.leaseToken);
    if (!session || session.status !== "running") {
      throw new Error("Claimed task session is no longer active.");
    }

    await client.query(
      `
        update tasks
        set
          state = 'running',
          started_at = coalesce(started_at, now()),
          finished_at = null,
          last_error = null,
          updated_at = now()
        where id = $1
          and state = 'queued'
      `,
      [claimed.taskId]
    );

    await refreshSessionLease(client, config, claimed.sessionId);

    const metadata = safeMetadata({
      workerId: config.workerId,
      sessionId: claimed.sessionId,
      agentId: claimed.agentId,
      executionKind: claimed.executionKind,
      attempt: claimed.attempt
    });

    await insertTaskEvent(client, {
      taskId: claimed.taskId,
      eventType: "worker.task.started",
      workerId: config.workerId,
      fromState: "queued",
      toState: "running",
      severity: "info",
      message: `Worker started ${claimed.executionKind} task.`,
      metadata
    });

    await recordWorkerAudit(client, {
      workerId: config.workerId,
      action: "worker.task.start",
      taskId: claimed.taskId,
      outcome: "success",
      metadata
    });

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function completeClaimedTask(pool: WorkerPool, config: TaskWorkerConfig, claimed: ClaimedTask): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const task = await selectTaskForUpdate(client, claimed.taskId);
    if (!task || task.state !== "running") {
      throw new Error("Claimed task is no longer running.");
    }

    await client.query(
      `
        update tasks
        set
          state = 'completed',
          finished_at = now(),
          last_error = null,
          updated_at = now()
        where id = $1
          and state = 'running'
      `,
      [claimed.taskId]
    );

    await client.query(
      `
        update agent_sessions
        set
          status = 'completed',
          ended_at = now(),
          heartbeat_at = now(),
          metadata = metadata || $2::jsonb
        where id = $1
      `,
      [
        claimed.sessionId,
        JSON.stringify({
          endedBy: "manual_lifecycle",
          executionKind: claimed.executionKind,
          workerId: config.workerId
        })
      ]
    );

    const metadata = safeMetadata({
      workerId: config.workerId,
      sessionId: claimed.sessionId,
      agentId: claimed.agentId,
      executionKind: claimed.executionKind,
      attempt: claimed.attempt
    });

    await insertTaskEvent(client, {
      taskId: claimed.taskId,
      eventType: "worker.task.completed",
      workerId: config.workerId,
      fromState: "running",
      toState: "completed",
      severity: "info",
      message: `Worker completed ${claimed.executionKind} task.`,
      metadata
    });

    await recordWorkerAudit(client, {
      workerId: config.workerId,
      action: "worker.task.complete",
      taskId: claimed.taskId,
      outcome: "success",
      metadata
    });

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function failClaimedTask(
  pool: WorkerPool,
  config: TaskWorkerConfig,
  claimed: ClaimedTask,
  error: unknown
): Promise<void> {
  const client = await pool.connect();
  const sanitizedError = sanitizeError(error);

  try {
    await client.query("begin");
    const task = await selectTaskForUpdate(client, claimed.taskId);
    const fromState = task?.state === "running" || task?.state === "queued" ? task.state : "running";

    await client.query(
      `
        update tasks
        set
          state = 'failed',
          finished_at = now(),
          last_error = $2,
          updated_at = now()
        where id = $1
          and state in ('queued', 'running')
      `,
      [claimed.taskId, sanitizedError]
    );

    await client.query(
      `
        update agent_sessions
        set
          status = 'failed',
          ended_at = now(),
          heartbeat_at = now(),
          metadata = metadata || $2::jsonb
        where id = $1
      `,
      [
        claimed.sessionId,
        JSON.stringify({
          endedBy: "worker_failure",
          workerId: config.workerId
        })
      ]
    );

    const metadata = safeMetadata({
      workerId: config.workerId,
      sessionId: claimed.sessionId,
      agentId: claimed.agentId,
      executionKind: claimed.executionKind,
      attempt: claimed.attempt,
      error: sanitizedError
    });

    await insertTaskEvent(client, {
      taskId: claimed.taskId,
      eventType: "worker.task.failed",
      workerId: config.workerId,
      fromState,
      toState: "failed",
      severity: "error",
      message: "Worker failed manual lifecycle task.",
      metadata
    });

    await recordWorkerAudit(client, {
      workerId: config.workerId,
      action: "worker.task.fail",
      taskId: claimed.taskId,
      outcome: "failure",
      metadata
    });

    await client.query("commit");
  } catch (failureError) {
    await client.query("rollback").catch(() => undefined);
    throw failureError;
  } finally {
    client.release();
  }
}

async function selectTaskForUpdate(client: WorkerClient, taskId: string): Promise<TaskRow | undefined> {
  const result = await client.query<TaskRow>(
    `
      select
        id,
        state,
        execution_kind,
        assigned_agent_id,
        priority,
        attempt_count,
        created_at,
        queued_at
      from tasks
      where id = $1
      for update
    `,
    [taskId]
  );
  return result.rows[0];
}

async function selectSessionForUpdate(
  client: WorkerClient,
  sessionId: string,
  leaseToken: string
): Promise<AgentSessionRow | undefined> {
  const result = await client.query<AgentSessionRow>(
    `
      select
        id,
        task_id,
        agent_id,
        status,
        attempt,
        lease_token
      from agent_sessions
      where id = $1
        and lease_token = $2
      for update
    `,
    [sessionId, leaseToken]
  );
  return result.rows[0];
}

async function refreshSessionLease(client: WorkerClient, config: TaskWorkerConfig, sessionId: string): Promise<void> {
  await client.query(
    `
      update agent_sessions
      set
        heartbeat_at = now(),
        lease_expires_at = now() + ($2::text || ' seconds')::interval
      where id = $1
        and status = 'running'
    `,
    [sessionId, config.leaseSeconds]
  );
}

async function insertTaskEvent(
  client: WorkerQueryable,
  event: {
    taskId: string;
    eventType: string;
    workerId: string;
    fromState: TaskRow["state"] | null;
    toState: TaskRow["state"] | null;
    severity: "debug" | "info" | "warn" | "error";
    message: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
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
      values ($1, $2, 'worker', $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      event.taskId,
      event.eventType,
      event.workerId,
      event.fromState,
      event.toState,
      event.severity,
      safeString(event.message),
      JSON.stringify(safeMetadata(event.metadata))
    ]
  );
}

async function recordWorkerAudit(
  client: WorkerQueryable,
  event: {
    workerId: string;
    action: string;
    taskId: string;
    outcome: "success" | "failure" | "denied";
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      insert into audit_log (
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        outcome,
        metadata
      )
      values ('worker', $1, $2, 'task', $3, $4, $5::jsonb)
    `,
    [
      event.workerId,
      event.action,
      event.taskId,
      event.outcome,
      JSON.stringify(safeMetadata(event.metadata))
    ]
  );
}

function defaultWorkerId(): string {
  return `frank-worker-${hostname()}-${process.pid}`;
}

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

async function defaultManualLifecycleExecutor(): Promise<void> {
  return undefined;
}

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Worker execution failed.";
  const compact = raw.replace(/\s+/g, " ").trim() || "Worker execution failed.";
  if (isSensitiveString(compact)) {
    return "Worker execution failed with a redacted error.";
  }
  return safeString(compact);
}

function safeMetadata(value: unknown): Record<string, unknown> {
  const redacted = redactMetadata(value);
  return isRecord(redacted) ? redacted : {};
}

function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactMetadata(item));
  }
  if (!isRecord(value)) {
    return typeof value === "string" ? safeString(value) : value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = isSensitiveMetadataKey(key) ? "[redacted]" : redactMetadata(nestedValue);
  }
  return result;
}

function safeString(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxSafeStringLength ? `${compact.slice(0, maxSafeStringLength)}...` : compact;
}

function isSensitiveString(value: string): boolean {
  return /secret|password|token|api[_-]?key|authorization|credential|private[_-]?key|bearer\s+\S+|sk-[a-z0-9]/i.test(value);
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return (
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("private_key") ||
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("credential")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
