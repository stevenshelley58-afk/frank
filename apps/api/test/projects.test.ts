import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("project registry routes", () => {
  it("creates and lists project workspaces inside the configured project root", async () => {
    const pool = new FakeProjectPool();
    const { server } = createTestServer(pool);

    const create = await server.inject({
      method: "POST",
      url: "/v1/projects",
      payload: {
        slug: "alpha-site",
        displayName: "Alpha Site",
        repoRemote: "git@github.com:example/alpha-site.git"
      }
    });

    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      project: {
        slug: "alpha-site",
        displayName: "Alpha Site",
        workspacePath: "/opt/frank-projects/alpha-site",
        backupPolicy: "local_vps"
      }
    });

    const list = await server.inject({
      method: "GET",
      url: "/v1/projects"
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().projects).toHaveLength(1);
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "project.create",
        outcome: "success"
      })
    ]);
  });

  it("rejects project workspaces outside the operator allowlist", async () => {
    const { server } = createTestServer(new FakeProjectPool());

    const response = await server.inject({
      method: "POST",
      url: "/v1/projects",
      payload: {
        slug: "bad",
        displayName: "Bad",
        workspacePath: "/tmp/bad"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_project_workspace"
    });
  });
});

function createTestServer(pool: FakeProjectPool) {
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
      hostAgent: {
        enabled: false,
        baseUrl: "http://host-agent.local",
        token: undefined,
        timeoutSeconds: 5
      },
      hermes: {
        enabled: true,
        apiBaseUrl: "http://hermes:8642",
        apiServerKey: "test-key",
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
        mode: "lab",
        repoWorkspacePath: "/opt/frank-hub",
        allowedWorkspaces: ["/opt/frank-hub", "/opt/frank-hub/workspaces", "/opt/frank-projects"],
        protectedPaths: ["/", "/root", "/etc", "/boot", "/var/lib/docker", "/var/lib/postgresql", "/opt/frank-backups", "/opt/frank-hub/.env", "/opt/frank-hub/runtime/access", "/opt/frank-hub/runtime/hermes/.env", "/opt/frank-hub/runtime/hermes/platforms/whatsapp/session"],
        accessEnvPath: "/opt/frank-hub/runtime/access/frank-access.env",
        secretWriteEnabled: true,
        secretWriteAllowedKeys: ["FRANK_WHATSAPP_NUMBER"],
        limits: {
          externalSendPerHour: 25,
          apiSpendUsdPerDay: 10,
          fileDeleteMaxCount: 500,
          hostCommandTimeoutSeconds: 1800,
          databaseDestructiveRequiresLimit: true
        }
      },
      messaging: {
        whatsapp: {
          enabled: true,
          mode: "bot",
          allowedUsers: ["15550000000"],
          webhookBaseUrl: "http://hermes:8644",
          webhookRoute: "frank-whatsapp",
          webhookSecret: "webhook-secret"
        }
      },
      accessProfile: {
        emailAddress: undefined,
        mobileNumber: undefined,
        whatsappNumber: "+15550000000",
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

interface ProjectRecord {
  id: string;
  slug: string;
  display_name: string;
  workspace_path: string;
  repo_remote: string | null;
  backup_policy: string;
  status: "active" | "paused" | "archived";
  metadata: Record<string, unknown>;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

class FakeProjectPool {
  readonly projects: ProjectRecord[] = [];
  readonly audits: Array<{ action: string; outcome: string }> = [];
  private idCounter = 1;

  async connect() {
    return new FakeProjectClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }
    if (normalized.startsWith("insert into projects")) {
      const project: ProjectRecord = {
        id: this.nextUuid(),
        slug: values[0] as string,
        display_name: values[1] as string,
        workspace_path: values[2] as string,
        repo_remote: values[3] as string | null,
        backup_policy: values[4] as string,
        status: "active",
        metadata: JSON.parse(values[5] as string) as Record<string, unknown>,
        last_activity_at: null,
        created_at: timestamp(),
        updated_at: timestamp()
      };
      this.projects.push(project);
      return rows([project] as Row[]);
    }
    if (normalized.startsWith("select") && normalized.includes("from projects")) {
      return rows(this.projects as Row[]);
    }
    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        action: values[2] as string,
        outcome: values[5] as string
      });
      return rows([]);
    }
    if (normalized.startsWith("select count(*)")) {
      return rows([{ count: "0" }] as Row[]);
    }
    throw new Error(`Unhandled fake query: ${normalized}`);
  }

  private nextUuid(): string {
    const suffix = String(this.idCounter).padStart(12, "0");
    this.idCounter += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

class FakeProjectClient {
  constructor(private readonly pool: FakeProjectPool) {}

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.pool.handleQuery<Row>(text, values);
  }

  release() {
    return undefined;
  }
}

function rows<Row>(items: Row[]) {
  return {
    rows: items,
    rowCount: items.length
  };
}

function timestamp(): string {
  return new Date(Date.UTC(2026, 4, 4, 0, 0, 1)).toISOString();
}

function openAiTestConfig() {
  return {
    apiKey: undefined,
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-test-chat"
  };
}
