import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimNextTask,
  expireStaleLeases,
  loadTaskWorkerConfig,
  runWorkerTick,
  type QueryResult,
  type WorkerClient,
  type WorkerPool
} from "../src/task-worker.js";

const workerConfig = {
  workerId: "test-worker",
  pollIntervalMs: 10_000,
  leaseSeconds: 60,
  batchSize: 1
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("task worker core", () => {
  it("defaults to batch size 1 and fails closed for other batch sizes", () => {
    expect(loadTaskWorkerConfig({ DATABASE_URL: "postgres://example", REDIS_URL: "redis://example" }).batchSize).toBe(1);
    expect(() => loadTaskWorkerConfig({ WORKER_BATCH_SIZE: "2" })).toThrow(/WORKER_BATCH_SIZE must be 1/);
  });

  it("claims one queued manual lifecycle task and records claim event/audit rows", async () => {
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: "frank" });

    const claim = await claimNextTask(db, workerConfig);

    expect(claim.status).toBe("claimed");
    expect(db.tasks.get("task-1")).toMatchObject({
      state: "queued",
      attempt_count: 1
    });
    expect(db.sessions).toHaveLength(1);
    expect(db.events).toEqual([
      expect.objectContaining({
        task_id: "task-1",
        event_type: "worker.task.claimed",
        severity: "info"
      })
    ]);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: "worker.task.claim",
        target_id: "task-1",
        outcome: "success"
      })
    ]);
  });

  it("uses FOR UPDATE SKIP LOCKED for queue claims", async () => {
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: "frank" });

    await claimNextTask(db, workerConfig);

    expect(db.queryLog.some((query) => query.includes("for update of t skip locked"))).toBe(true);
  });

  it("prevents concurrent workers from claiming the same queued task", async () => {
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: "frank" });

    const claims = await Promise.all([claimNextTask(db, workerConfig), claimNextTask(db, workerConfig)]);

    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "none")).toHaveLength(1);
    expect(db.sessions).toHaveLength(1);
  });

  it("blocks unassigned queued tasks without creating an agent session", async () => {
    const db = new FakeWorkerPool();
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: null });

    const result = await runWorkerTick(db, workerConfig);

    expect(result.claim).toEqual({
      status: "blocked",
      taskId: "task-1",
      reasonCode: "agent_unassigned"
    });
    expect(db.tasks.get("task-1")).toMatchObject({
      state: "blocked",
      last_error: "Task blocked because no agent is assigned."
    });
    expect(db.sessions).toHaveLength(0);
    expect(db.events).toEqual([
      expect.objectContaining({
        event_type: "worker.task.blocked",
        severity: "warn"
      })
    ]);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: "worker.task.block"
      })
    ]);
  });

  it.each([
    ["missing execution kind", null, "missing_execution_kind"],
    ["unsupported execution kind", "model_router_dry_run", "unsupported_execution_kind"]
  ])("blocks queued tasks with %s", async (_label, executionKind, reasonCode) => {
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({ id: "task-1", executionKind, assignedAgentId: "frank" });

    const result = await runWorkerTick(db, workerConfig);

    expect(result.claim).toEqual({
      status: "blocked",
      taskId: "task-1",
      reasonCode
    });
    expect(db.tasks.get("task-1")?.state).toBe("blocked");
    expect(db.sessions).toHaveLength(0);
    expect(db.events.map((event) => event.event_type)).toEqual(["worker.task.blocked"]);
  });

  it("blocks assigned tasks when the agent runtime is disabled", async () => {
    const db = new FakeWorkerPool();
    db.addAgent("image", { metadata: { runtime: "disabled" } });
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: "image" });

    const result = await runWorkerTick(db, workerConfig);

    expect(result.claim).toEqual({
      status: "blocked",
      taskId: "task-1",
      reasonCode: "agent_runtime_disabled"
    });
    expect(db.sessions).toHaveLength(0);
  });

  it("completes assigned manual lifecycle tasks without external/provider calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: "frank" });

    const result = await runWorkerTick(db, workerConfig);

    expect(result.claim).toEqual({
      status: "completed",
      taskId: "task-1",
      sessionId: "session-1"
    });
    expect(db.tasks.get("task-1")).toMatchObject({
      state: "completed",
      last_error: null
    });
    expect(db.sessions[0]).toMatchObject({
      status: "completed",
      ended_at: expect.any(String)
    });
    expect(db.events.map((event) => event.event_type)).toEqual([
      "worker.task.claimed",
      "worker.task.started",
      "worker.task.completed"
    ]);
    expect(db.audits.map((audit) => audit.action)).toEqual([
      "worker.task.claim",
      "worker.task.start",
      "worker.task.complete"
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dispatches hermes_operator tasks to the registered execution handler", async () => {
    const hermesExecutor = vi.fn(async () => undefined);
    const db = new FakeWorkerPool();
    db.addAgent("ops");
    db.addTask({ id: "task-1", executionKind: "hermes_operator", assignedAgentId: "ops" });

    const result = await runWorkerTick(db, workerConfig, {
      executionHandlers: {
        hermes_operator: hermesExecutor
      }
    });

    expect(result.claim).toEqual({
      status: "completed",
      taskId: "task-1",
      sessionId: "session-1"
    });
    expect(hermesExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        agentId: "ops",
        executionKind: "hermes_operator"
      })
    );
    expect(db.tasks.get("task-1")?.state).toBe("completed");
  });

  it("marks worker failures as failed with sanitized errors", async () => {
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: "frank" });

    const result = await runWorkerTick(db, workerConfig, {
      async manualLifecycleExecutor() {
        throw new Error("boom secret token sk-test should not leak");
      }
    });

    expect(result.claim).toEqual({
      status: "failed",
      taskId: "task-1",
      sessionId: "session-1"
    });
    const task = db.tasks.get("task-1");
    expect(task).toMatchObject({
      state: "failed",
      last_error: "Worker execution failed with a redacted error."
    });
    expect(JSON.stringify(db.events)).not.toContain("sk-test");
    expect(JSON.stringify(db.audits)).not.toContain("sk-test");
    expect(db.events.map((event) => event.event_type)).toEqual([
      "worker.task.claimed",
      "worker.task.started",
      "worker.task.failed"
    ]);
    expect(db.audits.map((audit) => audit.action)).toEqual([
      "worker.task.claim",
      "worker.task.start",
      "worker.task.fail"
    ]);
  });

  it("expires stale leases to failed without automatic retry", async () => {
    const db = new FakeWorkerPool();
    db.addAgent("frank");
    db.addTask({
      id: "task-1",
      state: "running",
      executionKind: "manual_lifecycle",
      assignedAgentId: "frank"
    });
    db.addSession({
      id: "session-1",
      taskId: "task-1",
      agentId: "frank",
      status: "running",
      leaseExpiresAt: 1
    });

    const expired = await expireStaleLeases(db, workerConfig);

    expect(expired).toBe(1);
    expect(db.tasks.get("task-1")).toMatchObject({
      state: "failed",
      attempt_count: 0,
      last_error: "Worker lease expired before task completed."
    });
    expect(db.sessions[0]).toMatchObject({
      status: "failed",
      ended_at: expect.any(String)
    });
    expect(db.events).toEqual([
      expect.objectContaining({
        event_type: "worker.lease_expired",
        from_state: "running",
        to_state: "failed"
      })
    ]);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: "worker.lease_expired",
        outcome: "failure"
      })
    ]);
  });

  it("appends task events without mutating existing history", async () => {
    const db = new FakeWorkerPool();
    db.addTask({ id: "task-1", executionKind: "manual_lifecycle", assignedAgentId: null });
    db.events.push({
      task_id: "task-1",
      event_type: "task.created",
      actor_type: "user",
      actor_id: "owner@example.com",
      from_state: null,
      to_state: "draft",
      severity: "info",
      message: "Created",
      metadata: {},
      created_at: timestamp(1)
    });

    await runWorkerTick(db, workerConfig);

    expect(db.events).toHaveLength(2);
    expect(db.events[0]).toMatchObject({
      event_type: "task.created",
      actor_id: "owner@example.com"
    });
    expect(db.events[1]).toMatchObject({
      event_type: "worker.task.blocked"
    });
  });
});

type TaskState = "draft" | "queued" | "running" | "blocked" | "waiting_approval" | "completed" | "failed" | "cancelled";
type AgentStatus = "available" | "disabled" | "planned";
type SessionStatus = "idle" | "running" | "blocked" | "completed" | "failed" | "cancelled";
type Severity = "debug" | "info" | "warn" | "error";

interface TaskRecord {
  id: string;
  state: TaskState;
  execution_kind: string | null;
  assigned_agent_id: string | null;
  priority: number;
  attempt_count: number;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  updated_at: string;
}

interface AgentRecord {
  id: string;
  status: AgentStatus;
  metadata: Record<string, unknown>;
}

interface SessionRecord {
  id: string;
  task_id: string | null;
  agent_id: string;
  status: SessionStatus;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  heartbeat_at: string | null;
  attempt: number;
  ended_at: string | null;
  metadata: Record<string, unknown>;
}

interface EventRecord {
  task_id: string;
  event_type: string;
  actor_type: "system" | "user" | "worker" | "agent";
  actor_id: string | null;
  from_state: TaskState | null;
  to_state: TaskState | null;
  severity: Severity;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditRecord {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: "success" | "failure" | "denied";
  metadata: Record<string, unknown>;
}

class FakeWorkerPool implements WorkerPool {
  readonly tasks = new Map<string, TaskRecord>();
  readonly agents = new Map<string, AgentRecord>();
  readonly sessions: SessionRecord[] = [];
  readonly events: EventRecord[] = [];
  readonly audits: AuditRecord[] = [];
  readonly queryLog: string[] = [];
  readonly lockedTasks = new Set<string>();
  now = 100;
  private sessionCounter = 1;

  addTask(options: {
    id: string;
    state?: TaskState;
    executionKind?: string | null;
    assignedAgentId?: string | null;
    priority?: number;
    queuedAt?: string | null;
  }): void {
    const createdAt = timestamp(this.tasks.size + 1);
    this.tasks.set(options.id, {
      id: options.id,
      state: options.state ?? "queued",
      execution_kind: options.executionKind === undefined ? "manual_lifecycle" : options.executionKind,
      assigned_agent_id: options.assignedAgentId === undefined ? "frank" : options.assignedAgentId,
      priority: options.priority ?? 100,
      attempt_count: 0,
      created_at: createdAt,
      queued_at: options.queuedAt === undefined ? createdAt : options.queuedAt,
      started_at: null,
      finished_at: null,
      last_error: null,
      updated_at: createdAt
    });
  }

  addAgent(id: string, options: { status?: AgentStatus; metadata?: Record<string, unknown> } = {}): void {
    this.agents.set(id, {
      id,
      status: options.status ?? "available",
      metadata: options.metadata ?? {}
    });
  }

  addSession(options: {
    id: string;
    taskId: string;
    agentId: string;
    status: SessionStatus;
    leaseExpiresAt: number | null;
  }): void {
    this.sessions.push({
      id: options.id,
      task_id: options.taskId,
      agent_id: options.agentId,
      status: options.status,
      worker_id: "other-worker",
      lease_token: "lease-token",
      lease_expires_at: options.leaseExpiresAt,
      heartbeat_at: timestamp(1),
      attempt: 1,
      ended_at: null,
      metadata: {}
    });
  }

  async connect(): Promise<WorkerClient> {
    return new FakeWorkerClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return new FakeWorkerClient(this).query<Row>(text, values);
  }

  releaseLocks(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      this.lockedTasks.delete(taskId);
    }
  }

  nextSessionId(): string {
    return `session-${this.sessionCounter++}`;
  }

  tick(): string {
    this.now += 1;
    return timestamp(this.now);
  }
}

class FakeWorkerClient implements WorkerClient {
  private readonly heldTaskLocks = new Set<string>();

  constructor(private readonly db: FakeWorkerPool) {}

  release(): void {
    this.db.releaseLocks([...this.heldTaskLocks]);
    this.heldTaskLocks.clear();
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    this.db.queryLog.push(normalized);

    if (normalized === "begin") {
      return rows([]);
    }
    if (normalized === "commit" || normalized === "rollback") {
      this.release();
      return rows([]);
    }

    if (normalized.includes("from agent_sessions s join tasks t") && normalized.includes("s.lease_expires_at < now()")) {
      const staleRows = this.db.sessions
        .filter((session) => {
          const task = session.task_id ? this.db.tasks.get(session.task_id) : undefined;
          return (
            session.status === "running" &&
            session.ended_at === null &&
            session.lease_expires_at !== null &&
            session.lease_expires_at < this.db.now &&
            Boolean(task && (task.state === "queued" || task.state === "running"))
          );
        })
        .map((session) => {
          const task = this.db.tasks.get(session.task_id ?? "");
          if (task) {
            this.lockTask(task.id);
          }
          return {
            session_id: session.id,
            task_id: session.task_id,
            agent_id: session.agent_id,
            task_state: task?.state,
            lease_expires_at: timestamp(session.lease_expires_at ?? 0)
          };
        });
      return rows(staleRows as Row[]);
    }

    if (normalized.includes("from tasks t") && normalized.includes("for update of t skip locked")) {
      const candidates = [...this.db.tasks.values()]
        .filter((task) => task.state === "queued")
        .filter((task) => !this.db.lockedTasks.has(task.id))
        .filter((task) => !this.db.sessions.some((session) => isActiveTaskSession(session, task.id)))
        .sort(compareQueuedTasks);
      const task = candidates[0];
      if (!task) {
        return rows([]);
      }
      this.lockTask(task.id);
      return rows([task] as Row[]);
    }

    if (normalized.includes("from agents") && normalized.includes("where id = $1")) {
      const agent = this.db.agents.get(values[0] as string);
      return rows((agent ? [agent] : []) as Row[]);
    }

    if (normalized.startsWith("insert into agent_sessions")) {
      const [
        agentId,
        taskId,
        workerId,
        leaseToken,
        leaseSeconds,
        attempt,
        rawMetadata
      ] = values as [string, string, string, string, number, number, string];
      if (this.db.sessions.some((session) => isActiveTaskSession(session, taskId))) {
        throw new Error("duplicate active task session");
      }
      const session: SessionRecord = {
        id: this.db.nextSessionId(),
        task_id: taskId,
        agent_id: agentId,
        status: "running",
        worker_id: workerId,
        lease_token: leaseToken,
        lease_expires_at: this.db.now + Number(leaseSeconds),
        heartbeat_at: this.db.tick(),
        attempt,
        ended_at: null,
        metadata: parseJson(rawMetadata)
      };
      this.db.sessions.push(session);
      return rows([
        {
          id: session.id,
          task_id: session.task_id,
          agent_id: session.agent_id,
          status: session.status,
          attempt: session.attempt,
          lease_token: session.lease_token
        }
      ] as Row[]);
    }

    if (normalized.startsWith("update tasks set attempt_count")) {
      const [taskId, attempt] = values as [string, number];
      const task = this.requireTask(taskId);
      task.attempt_count = attempt;
      task.queued_at = task.queued_at ?? this.db.tick();
      task.updated_at = this.db.tick();
      return rows([]);
    }

    if (normalized.startsWith("update tasks set state = 'blocked'")) {
      const [taskId, lastError] = values as [string, string];
      const task = this.requireTask(taskId);
      if (task.state === "queued") {
        task.state = "blocked";
        task.finished_at = this.db.tick();
        task.last_error = lastError;
        task.updated_at = this.db.tick();
      }
      return rows([]);
    }

    if (normalized.startsWith("insert into task_events")) {
      const [
        taskId,
        eventType,
        actorId,
        fromState,
        toState,
        severity,
        message,
        rawMetadata
      ] = values as [string, string, string, TaskState | null, TaskState | null, Severity, string, string];
      this.db.events.push({
        task_id: taskId,
        event_type: eventType,
        actor_type: "worker",
        actor_id: actorId,
        from_state: fromState,
        to_state: toState,
        severity,
        message,
        metadata: parseJson(rawMetadata),
        created_at: this.db.tick()
      });
      return rows([]);
    }

    if (normalized.startsWith("insert into audit_log")) {
      const [actorId, action, targetId, outcome, rawMetadata] = values as [
        string,
        string,
        string,
        AuditRecord["outcome"],
        string
      ];
      this.db.audits.push({
        actor_id: actorId,
        action,
        target_type: "task",
        target_id: targetId,
        outcome,
        metadata: parseJson(rawMetadata)
      });
      return rows([]);
    }

    if (normalized.includes("from tasks") && normalized.includes("where id = $1") && normalized.includes("for update")) {
      const task = this.db.tasks.get(values[0] as string);
      if (task) {
        this.lockTask(task.id);
      }
      return rows((task ? [task] : []) as Row[]);
    }

    if (normalized.includes("from agent_sessions") && normalized.includes("where id = $1") && normalized.includes("lease_token = $2")) {
      const [sessionId, leaseToken] = values as [string, string];
      const session = this.db.sessions.find((candidate) => candidate.id === sessionId && candidate.lease_token === leaseToken);
      return rows((session ? [session] : []) as Row[]);
    }

    if (normalized.startsWith("update tasks set state = 'running'")) {
      const task = this.requireTask(values[0] as string);
      if (task.state === "queued") {
        task.state = "running";
        task.started_at = task.started_at ?? this.db.tick();
        task.finished_at = null;
        task.last_error = null;
        task.updated_at = this.db.tick();
      }
      return rows([]);
    }

    if (normalized.startsWith("update agent_sessions set heartbeat_at")) {
      const [sessionId, leaseSeconds] = values as [string, number];
      const session = this.requireSession(sessionId);
      if (session.status === "running") {
        session.heartbeat_at = this.db.tick();
        session.lease_expires_at = this.db.now + Number(leaseSeconds);
      }
      return rows([]);
    }

    if (normalized.startsWith("update tasks set state = 'completed'")) {
      const task = this.requireTask(values[0] as string);
      if (task.state === "running") {
        task.state = "completed";
        task.finished_at = this.db.tick();
        task.last_error = null;
        task.updated_at = this.db.tick();
      }
      return rows([]);
    }

    if (normalized.startsWith("update agent_sessions set status = 'completed'")) {
      const [sessionId, rawMetadata] = values as [string, string];
      const session = this.requireSession(sessionId);
      session.status = "completed";
      session.ended_at = this.db.tick();
      session.heartbeat_at = this.db.tick();
      session.metadata = { ...session.metadata, ...parseJson(rawMetadata) };
      return rows([]);
    }

    if (normalized.startsWith("update tasks set state = 'failed'")) {
      const [taskId, lastError] = values as [string, string];
      const task = this.requireTask(taskId);
      if (task.state === "queued" || task.state === "running") {
        task.state = "failed";
        task.finished_at = this.db.tick();
        task.last_error = lastError;
        task.updated_at = this.db.tick();
      }
      return rows([]);
    }

    if (normalized.startsWith("update agent_sessions set status = 'failed'")) {
      const [sessionId, rawMetadata] = values as [string, string];
      const session = this.requireSession(sessionId);
      session.status = "failed";
      session.ended_at = this.db.tick();
      session.heartbeat_at = this.db.tick();
      session.metadata = { ...session.metadata, ...parseJson(rawMetadata) };
      return rows([]);
    }

    throw new Error(`Unhandled fake query: ${normalized}`);
  }

  private lockTask(taskId: string): void {
    this.db.lockedTasks.add(taskId);
    this.heldTaskLocks.add(taskId);
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.db.tasks.get(taskId);
    if (!task) {
      throw new Error(`Missing task ${taskId}`);
    }
    return task;
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.db.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      throw new Error(`Missing session ${sessionId}`);
    }
    return session;
  }
}

function rows<Row>(rowsValue: Row[]): QueryResult<Row> {
  return {
    rows: rowsValue,
    rowCount: rowsValue.length
  };
}

function parseJson(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function timestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

function isActiveTaskSession(session: SessionRecord, taskId: string): boolean {
  return session.task_id === taskId && session.status === "running" && session.ended_at === null;
}

function compareQueuedTasks(left: TaskRecord, right: TaskRecord): number {
  return (
    left.priority - right.priority ||
    nullableTimestamp(left.queued_at) - nullableTimestamp(right.queued_at) ||
    Date.parse(left.created_at) - Date.parse(right.created_at)
  );
}

function nullableTimestamp(value: string | null): number {
  return value ? Date.parse(value) : Number.POSITIVE_INFINITY;
}
