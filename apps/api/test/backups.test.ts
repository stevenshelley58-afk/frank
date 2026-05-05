import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("backup and Hermes kill switch routes", () => {
  it("records backup preflight metadata without exposing secrets", async () => {
    const pool = new FakeBackupPool();
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/backups/preflight"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      backup: {
        backupType: "preflight",
        status: "completed"
      },
      status: {
        backupRoot: "/tmp/frank-backups"
      }
    });
    expect(pool.backups).toHaveLength(1);
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "backup.preflight",
        outcome: "success"
      })
    ]);
    expect(response.body).not.toContain("HERMES_API_SERVER_KEY");
  });

  it("kill switch marks active Hermes sessions and tasks without stopping Frank services", async () => {
    const pool = new FakeBackupPool();
    pool.sessions.push({
      id: "00000000-0000-4000-8000-000000000111",
      task_id: "00000000-0000-4000-8000-000000000222",
      hermes_run_id: null,
      status: "running"
    });
    pool.tasks.set("00000000-0000-4000-8000-000000000222", {
      id: "00000000-0000-4000-8000-000000000222",
      state: "running",
      last_error: null
    });
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/runners/hermes/kill-switch",
      payload: {
        reason: "test kill switch"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      scope: "hermes",
      outcome: "partial",
      affectedSessions: [
        {
          sessionId: "00000000-0000-4000-8000-000000000111",
          method: "unavailable"
        }
      ]
    });
    expect(pool.sessions[0]).toMatchObject({
      status: "failed"
    });
    expect(pool.tasks.get("00000000-0000-4000-8000-000000000222")).toMatchObject({
      state: "failed"
    });
    expect(pool.killSwitchEvents).toHaveLength(1);
    expect(pool.serviceStops).toHaveLength(0);
  });
});

function createTestServer(pool: FakeBackupPool) {
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
        enabled: false,
        issuer: "https://frank.cloudflareaccess.com",
        audiences: ["test-aud"]
      },
      openai: openAiTestConfig(),
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
        root: "/tmp/frank-backups"
      },
      operator: {
        mode: "guarded",
        repoWorkspacePath: "/opt/frank-hub",
        allowedWorkspaces: ["/opt/frank-hub/workspaces"],
        protectedPaths: ["/", "/root", "/tmp/frank-backups", "/opt/frank-hub/.env"],
        accessEnvPath: "/opt/frank-hub/runtime/access/frank-access.env"
      },
      accessProfile: {
        emailAddress: undefined,
        mobileNumber: undefined,
        whatsappNumber: undefined,
        apiKeyNames: []
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

interface BackupRecord {
  id: string;
  backup_type: "postgres" | "files" | "preflight";
  status: "running" | "completed" | "failed";
  path: string | null;
  size_bytes: number | null;
  branch: string | null;
  commit: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

interface SessionRecord {
  id: string;
  task_id: string | null;
  hermes_run_id: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
}

interface TaskRecord {
  id: string;
  state: string;
  last_error: string | null;
}

interface AuditRecord {
  action: string;
  outcome: string;
}

class FakeBackupPool {
  readonly backups: BackupRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  readonly tasks = new Map<string, TaskRecord>();
  readonly audits: AuditRecord[] = [];
  readonly killSwitchEvents: unknown[] = [];
  readonly runnerEvents: unknown[] = [];
  readonly taskEvents: unknown[] = [];
  readonly serviceStops: unknown[] = [];
  private idCounter = 1;

  async connect() {
    return new FakeBackupClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []): QueryResult<Row> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }

    if (normalized.startsWith("insert into backup_runs")) {
      const record: BackupRecord = {
        id: this.nextUuid(),
        backup_type: values[0] as BackupRecord["backup_type"],
        status: normalized.includes("'completed'") ? "completed" : "running",
        path: normalized.includes("path") ? (values[1] as string | null) : null,
        size_bytes: normalized.includes("size_bytes") ? (values[2] as number | null) : null,
        branch: normalized.includes("branch") ? (values[3] as string | null) : null,
        commit: normalized.includes("commit") ? (values[4] as string | null) : null,
        metadata: normalized.includes("metadata") ? parseJson(values.at(-1)) ?? {} : {},
        created_at: timestamp(),
        finished_at: normalized.includes("'completed'") ? timestamp() : null
      };
      this.backups.push(record);
      return rows([record] as Row[]);
    }

    if (normalized.startsWith("select distinct on") || normalized.startsWith("select") && normalized.includes("from backup_runs")) {
      return rows(this.backups as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from runner_sessions")) {
      return rows(this.sessions.filter((session) => ["queued", "starting", "running", "stopping"].includes(session.status)) as Row[]);
    }

    if (normalized.startsWith("update runner_sessions")) {
      const session = this.sessions.find((candidate) => candidate.id === values[0]);
      if (session) {
        session.status = values[1] as SessionRecord["status"];
      }
      return rows([]);
    }

    if (normalized.startsWith("update tasks")) {
      const task = this.tasks.get(values[0] as string);
      if (task) {
        task.state = values[1] as string;
        task.last_error = values[2] as string;
      }
      return rows([]);
    }

    if (normalized.startsWith("insert into task_events")) {
      this.taskEvents.push(values);
      return rows([]);
    }

    if (normalized.startsWith("insert into runner_events")) {
      this.runnerEvents.push(values);
      return rows([]);
    }

    if (normalized.startsWith("insert into kill_switch_events")) {
      this.killSwitchEvents.push(values);
      return rows([]);
    }

    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        action: values[2] as string,
        outcome: values[5] as string
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
}

class FakeBackupClient {
  constructor(private readonly pool: FakeBackupPool) {}

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

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown> | null;
  }
  return (value ?? null) as Record<string, unknown> | null;
}

function timestamp(): string {
  return new Date(Date.UTC(2026, 3, 29, 0, 0, 1)).toISOString();
}

function openAiTestConfig() {
  return {
    apiKey: undefined,
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-test-chat"
  };
}
