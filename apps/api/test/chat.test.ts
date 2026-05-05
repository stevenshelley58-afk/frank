import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("chat routes", () => {
  it("reports OpenAI chat status without exposing credentials", async () => {
    const { server } = createTestServer(new FakeChatPool(), "sk-test-secret");

    const response = await server.inject({
      method: "GET",
      url: "/v1/chat/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("sk-test-secret");
    expect(response.json()).toMatchObject({
      provider: "openai",
      configured: true,
      apiKeyConfigured: true,
      modelConfigured: true,
      model: "gpt-test-chat"
    });
  });

  it("rejects chat requests until OPENAI_API_KEY is configured", async () => {
    const { server } = createTestServer(new FakeChatPool());

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/messages",
      payload: {
        message: "Hello Frank"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "chat_not_configured"
    });
  });

  it("sends chat messages through OpenAI Responses API and records redacted usage", async () => {
    const pool = new FakeChatPool();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "resp_test",
          output_text: "Frank is online.",
          usage: {
            input_tokens: 12,
            output_tokens: 4
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(pool, "sk-test-secret");

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/messages",
      payload: {
        message: "Are you connected?",
        mode: "chat"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("sk-test-secret");
    expect(response.json()).toMatchObject({
      assistantMessage: {
        role: "assistant",
        content: "Frank is online."
      },
      provider: "openai",
      model: "gpt-test-chat",
      responseId: "resp_test"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-secret"
        })
      })
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      model: "gpt-test-chat",
      input: "Are you connected?"
    });
    expect(pool.usages).toEqual([
      expect.objectContaining({
        provider_id: "openai",
        request_id: "resp_test",
        input_tokens: 12,
        output_tokens: 4
      })
    ]);
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "chat.openai.message",
        outcome: "success",
        metadata: {
          mode: "chat",
          model: "gpt-test-chat",
          responseId: "resp_test"
        }
      })
    ]);
    expect(JSON.stringify(pool.audits)).not.toContain("sk-test-secret");
  });
});

function createTestServer(pool: FakeChatPool, openaiApiKey?: string) {
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
      hostAgent: {
        enabled: false,
        baseUrl: "http://host-agent.local",
        token: undefined,
        timeoutSeconds: 5
      },
      openai: {
        apiKey: openaiApiKey,
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-test-chat"
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
        accessEnvPath: "/opt/frank-hub/runtime/access/frank-access.env",
        secretWriteEnabled: false,
        secretWriteAllowedKeys: ["OPENAI_API_KEY"],
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
          enabled: false,
          mode: "bot",
          allowedUsers: [],
          webhookBaseUrl: "http://hermes:8644",
          webhookRoute: "frank-whatsapp",
          webhookSecret: undefined
        }
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

interface AuditRecord {
  action: string;
  outcome: string;
  metadata: Record<string, unknown>;
}

interface UsageRecord {
  provider_id: string;
  request_id: string | null;
  input_tokens: number;
  output_tokens: number;
}

class FakeChatPool {
  readonly audits: AuditRecord[] = [];
  readonly usages: UsageRecord[] = [];

  async connect() {
    return new FakeChatClient(this);
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
        outcome: values[5] as string,
        metadata: JSON.parse(values[6] as string) as Record<string, unknown>
      });
      return rows([]);
    }
    if (normalized.startsWith("insert into model_usage")) {
      this.usages.push({
        provider_id: "openai",
        request_id: values[0] as string | null,
        input_tokens: values[1] as number,
        output_tokens: values[2] as number
      });
      return rows([]);
    }
    if (normalized.startsWith("select count(*)")) {
      return rows([{ count: "0" }] as Row[]);
    }
    throw new Error(`Unhandled fake query: ${normalized}`);
  }
}

class FakeChatClient {
  constructor(private readonly pool: FakeChatPool) {}

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
