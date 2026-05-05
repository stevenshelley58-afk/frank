import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("messaging routes", () => {
  it("reports WhatsApp readiness without exposing webhook secrets", async () => {
    const { server } = createTestServer(new FakeMessagingPool());

    const response = await server.inject({
      method: "GET",
      url: "/v1/messaging/whatsapp/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("webhook-secret");
    expect(response.json()).toMatchObject({
      whatsapp: {
        configured: true,
        numberConfigured: true,
        allowedUsersConfigured: true,
        webhookConfigured: true,
        provider: "hermes_native"
      },
      hermes: {
        enabled: true,
        privateApiConfigured: true
      }
    });
  });

  it("delivers WhatsApp notifications through the internal Hermes webhook with HMAC", async () => {
    const pool = new FakeMessagingPool();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "delivered" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/messaging/whatsapp/notify",
      payload: {
        message: "Self-upgrade completed",
        metadata: {
          selfUpgradeRunId: "00000000-0000-4000-8000-000000000111"
        }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).not.toContain("webhook-secret");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://hermes:8644/webhooks/frank-whatsapp");
    expect(init).toMatchObject({
      method: "POST"
    });
    const headers = init?.headers as Headers;
    expect(headers.get("X-Webhook-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(init?.body as string)).toMatchObject({
      message: "Self-upgrade completed",
      deliver_only: true,
      target: "whatsapp"
    });
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "messaging.whatsapp.notify",
        outcome: "success"
      })
    ]);
  });
});

function createTestServer(pool: FakeMessagingPool) {
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

class FakeMessagingPool {
  readonly audits: Array<{ action: string; outcome: string }> = [];

  async connect() {
    return new FakeMessagingClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
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
}

class FakeMessagingClient {
  constructor(private readonly pool: FakeMessagingPool) {}

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

function openAiTestConfig() {
  return {
    apiKey: undefined,
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-test-chat"
  };
}
