import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("audit log API route", () => {
  it("keeps audit log protected by Cloudflare Access", async () => {
    const { server } = createTestServer(new FakeAuditLogPool(), true);

    const response = await server.inject({
      method: "GET",
      url: "/v1/audit-log"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "cloudflare_access_required"
    });
  });

  it("lists audit log newest first without recursive read audit writes", async () => {
    const pool = new FakeAuditLogPool();
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "GET",
      url: "/v1/audit-log"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().auditLog.map((event: { action: string }) => event.action)).toEqual([
      "task.update",
      "agent.permissions.update",
      "task.create"
    ]);
    expect(response.json().pagination).toMatchObject({
      limit: 50,
      offset: 0,
      maxLimit: 100
    });
    expect(pool.insertedAudits).toHaveLength(0);
  });

  it("applies filters and caps limit", async () => {
    const { server } = createTestServer(new FakeAuditLogPool());

    const response = await server.inject({
      method: "GET",
      url:
        "/v1/audit-log?limit=500&offset=0&actor_type=user&action=task.update&resource_type=task&risk_level=write&project_id=alpha"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().pagination.limit).toBe(100);
    expect(response.json().auditLog).toHaveLength(1);
    expect(response.json().auditLog[0]).toMatchObject({
      action: "task.update",
      resourceType: "task"
    });
  });

  it("redacts sensitive metadata keys recursively", async () => {
    const { server } = createTestServer(new FakeAuditLogPool());

    const response = await server.inject({
      method: "GET",
      url: "/v1/audit-log?action=task.update"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().auditLog[0].metadata).toMatchObject({
      risk_level: "write",
      project_id: "alpha",
      nested: {
        openai: {
          apiKey: "[redacted]",
          baseUrl: "https://api.openai.com/v1",
          chatModel: "gpt-test-chat"
        },
        openrouterApiKey: "[redacted]",
        safe: "visible"
      },
      tokens: "[redacted]"
    });
    expect(JSON.stringify(response.json())).not.toContain("sk-live-secret");
    expect(JSON.stringify(response.json())).not.toContain("sk-openai-secret");
  });
});

function createTestServer(pool: FakeAuditLogPool, accessEnabled = false) {
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
      openai: openAiTestConfig(),
      openrouterApiKey: undefined,
      hostAgent: {
        enabled: false,
        baseUrl: "http://host-agent.local",
        token: undefined,
        timeoutSeconds: 5
      },
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

interface AuditLogRecord {
  id: string;
  occurred_at: string;
  actor_type: "system" | "user" | "worker" | "agent";
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: "success" | "failure" | "denied";
  metadata: Record<string, unknown>;
}

class FakeAuditLogPool {
  readonly insertedAudits: unknown[] = [];
  readonly records: AuditLogRecord[] = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      occurred_at: "2026-04-28T00:00:01.000Z",
      actor_type: "user",
      actor_id: "local-dev@frank.fail",
      action: "task.create",
      target_type: "task",
      target_id: "task-1",
      outcome: "success",
      metadata: {
        risk_level: "write",
        project_id: "beta"
      }
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      occurred_at: "2026-04-28T00:00:02.000Z",
      actor_type: "user",
      actor_id: "local-dev@frank.fail",
      action: "agent.permissions.update",
      target_type: "agent",
      target_id: "frank",
      outcome: "success",
      metadata: {
        risk_level: "write",
        project_id: "alpha"
      }
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      occurred_at: "2026-04-28T00:00:03.000Z",
      actor_type: "user",
      actor_id: "local-dev@frank.fail",
      action: "task.update",
      target_type: "task",
      target_id: "task-1",
      outcome: "success",
      metadata: {
        risk_level: "write",
        project_id: "alpha",
        nested: {
          openai: {
            apiKey: "sk-openai-secret",
            baseUrl: "https://api.openai.com/v1",
            chatModel: "gpt-test-chat"
          },
          openrouterApiKey: "sk-live-secret",
          safe: "visible"
        },
        tokens: ["secret-token"]
      }
    }
  ];

  async connect() {
    return {
      query: this.query.bind(this),
      release() {
        return undefined;
      }
    };
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("select") && normalized.includes("from audit_log")) {
      let records = [...this.records];
      const limit = values.at(-2) as number | undefined;
      const offset = values.at(-1) as number | undefined;

      if (normalized.includes("actor_type =")) {
        records = records.filter((record) => record.actor_type === "user");
      }
      if (normalized.includes("action =")) {
        const action = values.find((value) => value === "task.update" || value === "agent.permissions.update");
        if (action) {
          records = records.filter((record) => record.action === action);
        }
      }
      if (normalized.includes("target_type =")) {
        records = records.filter((record) => record.target_type === "task");
      }
      if (normalized.includes("metadata ->> 'risk_level'")) {
        records = records.filter((record) => record.metadata.risk_level === "write");
      }
      if (normalized.includes("metadata ->> 'project_id'")) {
        records = records.filter((record) => record.metadata.project_id === "alpha");
      }

      records.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
      return rows(records.slice(offset ?? 0, (offset ?? 0) + (limit ?? records.length)) as Row[]);
    }

    if (normalized.startsWith("insert into audit_log")) {
      this.insertedAudits.push(values);
      return rows([]);
    }

    throw new Error(`Unhandled fake query: ${normalized}`);
  }
}

function rows<Row>(items: Row[]): QueryResult<Row> {
  return {
    rows: items,
    rowCount: items.length
  };
}

function openAiTestConfig() {
  return {
    apiKey: undefined,
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-test-chat"
  };
}
