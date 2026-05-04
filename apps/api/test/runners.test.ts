import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];
const httpServers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("Hermes runner discovery routes", () => {
  it("reports disabled Hermes cleanly", async () => {
    const { server } = createTestServer();

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        id: "hermes",
        status: "disabled"
      },
      status: {
        enabled: false,
        configured: false,
        reachable: false,
        health: "unavailable"
      }
    });
  });

  it("refuses enabled Hermes mode when API_SERVER_KEY is missing", async () => {
    const { server } = createTestServer({
      enabled: true,
      apiServerKey: undefined
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        status: "not_configured"
      },
      status: {
        enabled: true,
        configured: false,
        reachable: false,
        health: "error"
      }
    });
  });

  it("reports unreachable Hermes without exposing the API key", async () => {
    const { server } = createTestServer({
      enabled: true,
      apiBaseUrl: "http://127.0.0.1:9",
      apiServerKey: "secret-test-key"
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        status: "unavailable"
      },
      status: {
        configured: true,
        reachable: false,
        health: "unavailable"
      }
    });
    expect(response.body).not.toContain("secret-test-key");
  });

  it("reports reachable Hermes models and sends bearer auth server-side", async () => {
    const seenHeaders: string[] = [];
    const fakeHermes = await startFakeHermes((request, reply) => {
      const authorization = request.headers.authorization;
      seenHeaders.push(Array.isArray(authorization) ? authorization.join(",") : authorization ?? "");
      reply.setHeader("Content-Type", "application/json");

      if (request.url === "/health") {
        reply.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/health/detailed") {
        reply.end(JSON.stringify({ status: "ok", gateway: "running" }));
        return;
      }
      if (request.url === "/v1/models") {
        reply.end(JSON.stringify({ data: [{ id: "hermes-agent" }] }));
        return;
      }

      reply.statusCode = 404;
      reply.end(JSON.stringify({ error: "not_found" }));
    });

    const { server } = createTestServer({
      enabled: true,
      apiBaseUrl: fakeHermes.url,
      apiServerKey: "secret-test-key"
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/runners/hermes/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runner: {
        status: "available"
      },
      status: {
        enabled: true,
        configured: true,
        reachable: true,
        health: "ok",
        models: ["hermes-agent"],
        detailedHealth: {
          gateway: "running"
        }
      }
    });
    expect(seenHeaders).toEqual(["Bearer secret-test-key", "Bearer secret-test-key", "Bearer secret-test-key"]);
    expect(response.body).not.toContain("secret-test-key");
  });

  it("starts a safe Hermes test run, persists events, and stops the session", async () => {
    const pool = new FakeRunnerPool();
    const fakeHermes = await startFakeHermes((request, reply) => {
      reply.setHeader("Content-Type", "application/json");

      if (request.url === "/health") {
        reply.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/health/detailed") {
        reply.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (request.url === "/v1/models") {
        reply.end(JSON.stringify({ data: [{ id: "hermes-agent" }] }));
        return;
      }
      if (request.url === "/v1/runs" && request.method === "POST") {
        reply.statusCode = 202;
        reply.end(JSON.stringify({ run_id: "run_test_1", status: "started" }));
        return;
      }
      if (request.url === "/v1/runs/run_test_1/stop" && request.method === "POST") {
        reply.end(JSON.stringify({ run_id: "run_test_1", status: "stopping" }));
        return;
      }

      reply.statusCode = 404;
      reply.end(JSON.stringify({ error: "not_found" }));
    });

    const { server } = createTestServer(
      {
        enabled: true,
        apiBaseUrl: fakeHermes.url,
        apiServerKey: "secret-test-key"
      },
      pool
    );

    const start = await server.inject({
      method: "POST",
      url: "/v1/runners/hermes/test-run",
      payload: {
        prompt: "Reply with ok only."
      }
    });

    expect(start.statusCode).toBe(202);
    const sessionId = start.json().session.id;
    expect(start.json()).toMatchObject({
      session: {
        id: sessionId,
        hermesRunId: "run_test_1",
        status: "running"
      },
      startResult: {
        status: "running"
      }
    });
    expect(pool.events.map((event) => event.sequence)).toEqual([1, 2]);

    const events = await server.inject({
      method: "GET",
      url: `/v1/runners/hermes/sessions/${sessionId}/events?after_sequence=0&limit=10`
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toMatchObject({
      last_sequence: 2,
      next_cursor: 2
    });

    const stop = await server.inject({
      method: "POST",
      url: `/v1/runners/hermes/stop/${sessionId}`,
      payload: {
        reason: "test complete"
      }
    });

    expect(stop.statusCode).toBe(200);
    expect(stop.json()).toMatchObject({
      session: {
        status: "cancelled"
      },
      stopResult: {
        stopped: true,
        method: "api"
      }
    });
    expect(pool.audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(["runner.hermes.test_run", "runner.hermes.stop_request", "runner.hermes.stop_success"])
    );
  });
});

function createTestServer(hermes: Partial<ApiConfig["hermes"]> = {}, pool: unknown = {}) {
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
      openrouterApiKey: undefined,
      hermes: {
        enabled: false,
        apiBaseUrl: "http://127.0.0.1:8642",
        apiServerKey: undefined,
        timeoutSeconds: 1800,
        stallTimeoutSeconds: 300,
        eventsPollMs: 1000,
        workspaceRoot: "/opt/frank-hub/workspaces",
        artifactRoot: "/opt/frank-hub/runtime/artifacts",
        ...hermes
      },
      backups: {
        root: "/opt/frank-backups"
      },
      operator: {
        mode: "guarded",
        repoWorkspacePath: "/opt/frank-hub",
        allowedWorkspaces: ["/opt/frank-hub/workspaces"],
        protectedPaths: ["/", "/root", "/opt/frank-backups", "/opt/frank-hub/.env"],
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

interface RunnerSessionRecord {
  id: string;
  task_id: string | null;
  runner_id: string;
  hermes_run_id: string | null;
  conversation_id: string | null;
  workspace_path: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
  started_at: string | null;
  finished_at: string | null;
  last_event_at: string | null;
  exit_code: number | null;
  error_summary: string | null;
  final_output: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface RunnerEventRecord {
  id: string;
  runner_session_id: string;
  task_id: string | null;
  source: "frank" | "hermes" | "system";
  event_type: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
  raw_event: Record<string, unknown> | null;
  sequence: number;
  created_at: string;
}

interface AuditRecord {
  action: string;
}

class FakeRunnerPool {
  readonly sessions = new Map<string, RunnerSessionRecord>();
  readonly events: RunnerEventRecord[] = [];
  readonly audits: AuditRecord[] = [];
  private idCounter = 1;
  private clock = 1;

  async connect() {
    return new FakeRunnerClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []): QueryResult<Row> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }

    if (normalized.startsWith("insert into runners")) {
      return rows([]);
    }

    if (normalized.startsWith("insert into runner_sessions")) {
      const session: RunnerSessionRecord = {
        id: this.nextUuid(),
        task_id: values[0] as string | null,
        runner_id: "hermes",
        hermes_run_id: null,
        conversation_id: null,
        workspace_path: values[1] as string | null,
        status: values[2] as RunnerSessionRecord["status"],
        started_at: null,
        finished_at: null,
        last_event_at: null,
        exit_code: null,
        error_summary: null,
        final_output: null,
        metadata: parseJson(values[3]),
        created_at: this.now(),
        updated_at: this.now()
      };
      this.sessions.set(session.id, session);
      return rows([session] as Row[]);
    }

    if (normalized.startsWith("update runner_sessions") && normalized.includes("hermes_run_id = $2")) {
      const session = this.sessions.get(values[0] as string);
      if (!session) {
        return rows([]);
      }
      session.hermes_run_id = values[1] as string | null;
      session.conversation_id = values[2] as string | null;
      session.status = values[3] as RunnerSessionRecord["status"];
      session.error_summary = values[4] as string | null;
      session.started_at = session.status === "running" ? this.now() : session.started_at;
      session.finished_at = ["failed", "blocked"].includes(session.status) ? this.now() : session.finished_at;
      session.updated_at = this.now();
      return rows([session] as Row[]);
    }

    if (normalized.startsWith("update runner_sessions") && normalized.includes("set status = 'stopping'")) {
      const session = this.sessions.get(values[0] as string);
      if (session) {
        session.status = "stopping";
        session.updated_at = this.now();
      }
      return rows([]);
    }

    if (normalized.startsWith("update runner_sessions") && normalized.includes("finished_at = now()")) {
      const session = this.sessions.get(values[0] as string);
      if (!session) {
        return rows([]);
      }
      session.status = values[1] as RunnerSessionRecord["status"];
      session.error_summary = values[2] as string | null;
      session.finished_at = this.now();
      session.updated_at = this.now();
      return rows([session] as Row[]);
    }

    if (normalized.startsWith("insert into runner_events")) {
      const runnerSessionId = values[0] as string;
      const event: RunnerEventRecord = {
        id: this.nextUuid(),
        runner_session_id: runnerSessionId,
        task_id: values[1] as string | null,
        source: values[2] as RunnerEventRecord["source"],
        event_type: values[3] as string,
        severity: values[4] as RunnerEventRecord["severity"],
        message: values[5] as string,
        raw_event: parseJson(values[6]) as Record<string, unknown> | null,
        sequence: this.events.filter((item) => item.runner_session_id === runnerSessionId).length + 1,
        created_at: this.now()
      };
      this.events.push(event);
      return rows([event] as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from runner_sessions")) {
      const session = this.sessions.get(values[0] as string);
      return rows((session ? [session] : []) as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from runner_events")) {
      const sessionId = values[0] as string;
      const afterSequence = values[1] as number;
      const limit = values[2] as number;
      return rows(
        this.events
          .filter((event) => event.runner_session_id === sessionId && event.sequence > afterSequence)
          .sort((left, right) => left.sequence - right.sequence)
          .slice(0, limit) as Row[]
      );
    }

    if (normalized.startsWith("insert into runner_stop_requests")) {
      return rows([]);
    }

    if (normalized.startsWith("update runner_stop_requests")) {
      return rows([]);
    }

    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        action: values[2] as string
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
    const value = new Date(Date.UTC(2026, 3, 29, 0, 0, this.clock)).toISOString();
    this.clock += 1;
    return value;
  }
}

class FakeRunnerClient {
  constructor(private readonly pool: FakeRunnerPool) {}

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

async function startFakeHermes(
  handler: (request: IncomingMessage, reply: ServerResponse) => void
): Promise<{ url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  httpServers.push(server);
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`
  };
}
