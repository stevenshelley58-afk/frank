import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("operator access secret writer", () => {
  it("denies access file writes unless lab secret writing is explicitly enabled", async () => {
    const accessDir = path.join(tmpdir(), `frank-access-disabled-${Date.now()}`);
    cleanupPaths.push(accessDir);
    const pool = new FakeOperatorPool();
    const { server } = createTestServer(pool, accessDir, false);

    const response = await server.inject({
      method: "PATCH",
      url: "/v1/operator/access",
      payload: {
        values: {
          FRANK_WHATSAPP_NUMBER: "+15550000000"
        }
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "secret_write_disabled"
    });
    expect(pool.audits).toEqual([]);
  });

  it("writes only allowlisted access keys and never echoes secret values", async () => {
    const accessDir = path.join(tmpdir(), `frank-access-enabled-${Date.now()}`);
    cleanupPaths.push(accessDir);
    const pool = new FakeOperatorPool();
    const { server, accessPath } = createTestServer(pool, accessDir, true);

    const response = await server.inject({
      method: "PATCH",
      url: "/v1/operator/access",
      payload: {
        values: {
          FRANK_WHATSAPP_NUMBER: "+15550000000",
          FRANK_API_KEY_NAMES: "OPENROUTER_API_KEY,FRANK_WHATSAPP_API_TOKEN",
          FRANK_WHATSAPP_API_TOKEN: "super-secret-token"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("super-secret-token");
    expect(response.json()).toMatchObject({
      accessWrite: {
        enabled: true,
        written: true
      },
      writtenKeys: [
        { key: "FRANK_WHATSAPP_NUMBER", configured: true },
        { key: "FRANK_API_KEY_NAMES", configured: true },
        { key: "FRANK_WHATSAPP_API_TOKEN", configured: true }
      ]
    });
    expect(response.json().writtenKeys[2].fingerprint).toMatch(/^sha256:[a-f0-9]{12}$/);
    await expect(readFile(accessPath, "utf8")).resolves.toContain("FRANK_WHATSAPP_API_TOKEN=super-secret-token");
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "operator.access.write",
        outcome: "success",
        metadata: {
          keys: ["FRANK_WHATSAPP_NUMBER", "FRANK_API_KEY_NAMES", "FRANK_WHATSAPP_API_TOKEN"]
        }
      })
    ]);
  });

  it("rejects protected or unknown access keys", async () => {
    const accessDir = path.join(tmpdir(), `frank-access-denied-${Date.now()}`);
    cleanupPaths.push(accessDir);
    const { server } = createTestServer(new FakeOperatorPool(), accessDir, true);

    const response = await server.inject({
      method: "PATCH",
      url: "/v1/operator/access",
      payload: {
        values: {
          DATABASE_URL: "postgres://secret"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "access_key_denied"
    });
  });
});

function createTestServer(pool: FakeOperatorPool, accessDir: string, secretWriteEnabled: boolean) {
  const accessPath = path.join(accessDir, "frank-access.env");
  const config = baseConfig({
    operator: {
      secretWriteEnabled,
      accessEnvPath: accessPath
    },
    accessProfile: {
      whatsappNumber: "+15551111111",
      apiKeyNames: ["FRANK_WHATSAPP_API_TOKEN"]
    }
  });
  const server = buildServer({
    config,
    pool: pool as never,
    redis: {} as never
  });
  servers.push(server);
  return { server, accessPath };
}

function baseConfig(overrides: {
  operator?: Partial<ApiConfig["operator"]>;
  accessProfile?: Partial<ApiConfig["accessProfile"]>;
} = {}): ApiConfig {
  return {
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
      secretWriteEnabled: false,
      secretWriteAllowedKeys: [
        "FRANK_EMAIL_ADDRESS",
        "FRANK_MOBILE_NUMBER",
        "FRANK_WHATSAPP_NUMBER",
        "FRANK_API_KEY_NAMES",
        "FRANK_EMAIL_APP_PASSWORD",
        "FRANK_WHATSAPP_API_TOKEN",
        "OPENROUTER_API_KEY",
        "WHATSAPP_ENABLED",
        "WHATSAPP_MODE",
        "WHATSAPP_ALLOWED_USERS",
        "WEBHOOK_ENABLED",
        "WEBHOOK_SECRET"
      ],
      limits: {
        externalSendPerHour: 25,
        apiSpendUsdPerDay: 10,
        fileDeleteMaxCount: 500,
        hostCommandTimeoutSeconds: 1800,
        databaseDestructiveRequiresLimit: true
      },
      ...overrides.operator
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
      whatsappNumber: undefined,
      apiKeyNames: [],
      ...overrides.accessProfile
    },
    logLevel: "silent"
  } satisfies ApiConfig;
}

class FakeOperatorPool {
  readonly audits: Array<{ action: string; outcome: string; metadata: Record<string, unknown> }> = [];

  async connect() {
    return new FakeOperatorClient(this);
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
    if (normalized.startsWith("select count(*)")) {
      return rows([{ count: "0" }] as Row[]);
    }
    throw new Error(`Unhandled fake query: ${normalized}`);
  }
}

class FakeOperatorClient {
  constructor(private readonly pool: FakeOperatorPool) {}

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
