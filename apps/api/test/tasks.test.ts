import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";
import type { TaskState } from "@frank/shared";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("task API routes", () => {
  it("keeps task routes protected by Cloudflare Access", async () => {
    const { server } = createTestServer(new FakeTaskPool(), true);

    const response = await server.inject({
      method: "GET",
      url: "/v1/tasks"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "cloudflare_access_required"
    });
  });

  it("creates, lists, and fetches tasks with audit and creation events", async () => {
    const pool = new FakeTaskPool();
    const { server } = createTestServer(pool);

    const create = await server.inject({
      method: "POST",
      url: "/v1/tasks",
      payload: {
        title: "Review deployment notes",
        priority: 25,
        metadata: {
          source: "test"
        }
      }
    });

    expect(create.statusCode).toBe(201);
    const created = create.json().task;
    expect(created).toMatchObject({
      title: "Review deployment notes",
      state: "draft",
      priority: 25,
      createdBy: "local-dev@frank.fail"
    });
    expect(pool.events).toEqual([
      expect.objectContaining({
        task_id: created.id,
        event_type: "task.created",
        to_state: "draft"
      })
    ]);
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "task.create",
        target_id: created.id
      })
    ]);

    const list = await server.inject({
      method: "GET",
      url: "/v1/tasks"
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().tasks).toHaveLength(1);
    expect(list.json().tasks[0].id).toBe(created.id);

    const get = await server.inject({
      method: "GET",
      url: `/v1/tasks/${created.id}`
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().task.id).toBe(created.id);
  });

  it("rejects invalid transitions and requires explicit reopened=true for completed tasks", async () => {
    const pool = new FakeTaskPool();
    const { server } = createTestServer(pool);
    const created = (
      await server.inject({
        method: "POST",
        url: "/v1/tasks",
        payload: {
          title: "Lifecycle test"
        }
      })
    ).json().task;

    const invalidTransition = await server.inject({
      method: "PATCH",
      url: `/v1/tasks/${created.id}`,
      payload: {
        state: "completed"
      }
    });
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json()).toMatchObject({
      error: "invalid_state_transition"
    });

    await expectPatchState(server, created.id, "queued");
    await expectPatchState(server, created.id, "running");
    await expectPatchState(server, created.id, "completed");

    const missingReopen = await server.inject({
      method: "PATCH",
      url: `/v1/tasks/${created.id}`,
      payload: {
        state: "queued"
      }
    });
    expect(missingReopen.statusCode).toBe(400);
    expect(missingReopen.json()).toMatchObject({
      error: "invalid_reopen",
      message: "Reopening a completed or cancelled task requires reopened=true."
    });

    const invalidReopen = await server.inject({
      method: "PATCH",
      url: `/v1/tasks/${created.id}`,
      payload: {
        state: "running",
        reopened: true
      }
    });
    expect(invalidReopen.statusCode).toBe(400);
    expect(invalidReopen.json()).toMatchObject({
      error: "invalid_reopen"
    });

    const reopen = await server.inject({
      method: "PATCH",
      url: `/v1/tasks/${created.id}`,
      payload: {
        state: "queued",
        reopened: true
      }
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().task.state).toBe("queued");
    expect(pool.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "task.reopened",
          from_state: "completed",
          to_state: "queued"
        })
      ])
    );
    expect(pool.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "task.reopen",
          target_id: created.id
        })
      ])
    );
  });

  it("appends task events without mutating existing events", async () => {
    const pool = new FakeTaskPool();
    const { server } = createTestServer(pool);
    const created = (
      await server.inject({
        method: "POST",
        url: "/v1/tasks",
        payload: {
          title: "Event test"
        }
      })
    ).json().task;
    const eventCountAfterCreate = pool.events.length;

    const append = await server.inject({
      method: "POST",
      url: `/v1/tasks/${created.id}/events`,
      payload: {
        eventType: "task.note",
        metadata: {
          note: "Dashboard-only note"
        }
      }
    });

    expect(append.statusCode).toBe(201);
    expect(pool.events).toHaveLength(eventCountAfterCreate + 1);
    expect(pool.events[0]?.event_type).toBe("task.created");
    expect(pool.events[1]).toEqual(
      expect.objectContaining({
        event_type: "task.note",
        metadata: {
          note: "Dashboard-only note"
        }
      })
    );

    const events = await server.inject({
      method: "GET",
      url: `/v1/tasks/${created.id}/events`
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events.map((event: { eventType: string }) => event.eventType)).toEqual([
      "task.created",
      "task.note"
    ]);
    expect(pool.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "task.event.append",
          target_id: created.id
        })
      ])
    );
  });
});

async function expectPatchState(server: FastifyInstance, id: string, state: TaskState): Promise<void> {
  const response = await server.inject({
    method: "PATCH",
    url: `/v1/tasks/${id}`,
    payload: {
      state
    }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().task.state).toBe(state);
}

function createTestServer(pool: FakeTaskPool, accessEnabled = false) {
  const server = buildServer({
    config: {
      environment: "test",
      systemName: "Frank Hub",
      domain: "frank.fail",
      dashboardUrl: "https://hub.frank.fail",
      apiUrl: "https://api.frank.fail",
      port: 0,
      databaseUrl: "postgres://frank:test@postgres:5432/frank",
      redisUrl: "redis://redis:6379",
      corsOrigins: [],
      cloudflareAccess: {
        enabled: accessEnabled,
        issuer: "https://frank.cloudflareaccess.com",
        audiences: ["test-aud"]
      },
      openrouterApiKey: undefined,
      hermes: {
        enabled: false,
        apiBaseUrl: "http://127.0.0.1:8642",
        apiServerKey: undefined,
        timeoutSeconds: 1800,
        stallTimeoutSeconds: 300,
        eventsPollMs: 1000,
        workspaceRoot: "/opt/frank-hub/workspaces",
        artifactRoot: "/opt/frank-hub/runtime/artifacts"
      },
      backups: {
        root: "/opt/frank-backups"
      },
      logLevel: "silent"
    } satisfies ApiConfig,
    pool: pool as never,
    redis: {} as never
  });
  servers.push(server);
  return { server };
}

type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  state: TaskState;
  priority: number;
  created_by: string | null;
  assigned_agent_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface TaskEventRecord {
  id: string;
  task_id: string;
  event_type: string;
  actor_type: "system" | "user" | "worker" | "agent";
  actor_id: string | null;
  from_state: TaskState | null;
  to_state: TaskState | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AuditRecord {
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

class FakeTaskPool {
  readonly tasks = new Map<string, TaskRecord>();
  readonly events: TaskEventRecord[] = [];
  readonly audits: AuditRecord[] = [];
  private idCounter = 1;
  private clock = 1;

  async connect() {
    return new FakeTaskClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []): QueryResult<Row> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }

    if (normalized.startsWith("insert into tasks")) {
      const record: TaskRecord = {
        id: this.nextUuid(),
        title: values[0] as string,
        description: values[1] as string | null,
        state: "draft",
        priority: values[2] as number,
        created_by: values[3] as string,
        assigned_agent_id: values[4] as string | null,
        metadata: parseJson(values[5]),
        created_at: this.now(),
        updated_at: this.now()
      };
      this.tasks.set(record.id, record);
      return rows([record] as Row[]);
    }

    if (normalized.startsWith("update tasks")) {
      const id = values[0] as string;
      const current = this.tasks.get(id);
      if (!current) {
        return rows([]);
      }
      const updated: TaskRecord = {
        ...current,
        title: values[1] as string,
        description: values[2] as string | null,
        state: values[3] as TaskState,
        priority: values[4] as number,
        assigned_agent_id: values[5] as string | null,
        metadata: parseJson(values[6]),
        updated_at: this.now()
      };
      this.tasks.set(id, updated);
      return rows([updated] as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from tasks") && normalized.includes("where id = $1")) {
      const task = this.tasks.get(values[0] as string);
      return rows((task ? [task] : []) as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from tasks")) {
      const records = [...this.tasks.values()].sort((left, right) =>
        right.created_at.localeCompare(left.created_at)
      );
      return rows(records as Row[]);
    }

    if (normalized.startsWith("insert into task_events")) {
      const event: TaskEventRecord = {
        id: this.nextUuid(),
        task_id: values[0] as string,
        event_type: values[1] as string,
        actor_type: values[2] as TaskEventRecord["actor_type"],
        actor_id: values[3] as string | null,
        from_state: values[4] as TaskState | null,
        to_state: values[5] as TaskState | null,
        metadata: parseJson(values[6]),
        created_at: this.now()
      };
      this.events.push(event);
      return rows([event] as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from task_events")) {
      const taskId = values[0] as string;
      return rows(this.events.filter((event) => event.task_id === taskId) as Row[]);
    }

    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        actor_type: values[0] as string,
        actor_id: values[1] as string | null,
        action: values[2] as string,
        target_type: values[3] as string,
        target_id: values[4] as string | null,
        outcome: values[5] as string,
        metadata: parseJson(values[6])
      });
      return rows([]);
    }

    throw new Error(`Unhandled fake query: ${normalized}`);
  }

  private nextUuid(): string {
    const suffix = String(this.idCounter).padStart(12, "0");
    this.idCounter += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }

  private now(): string {
    const value = new Date(Date.UTC(2026, 3, 28, 0, 0, this.clock)).toISOString();
    this.clock += 1;
    return value;
  }
}

class FakeTaskClient {
  constructor(private readonly pool: FakeTaskPool) {}

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.handleQuery<Row>(text, values);
  }

  release() {
    return undefined;
  }
}

function rows<Row>(items: Row[]): QueryResult<Row> {
  return {
    rows: items,
    rowCount: items.length
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}
