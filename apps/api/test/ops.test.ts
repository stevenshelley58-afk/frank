import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";
import { collectDeploy, type OpsCollectors } from "../src/routes/ops.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("read-only ops API routes", () => {
  it("keeps ops routes protected by Cloudflare Access", async () => {
    const { server } = createTestServer(new FakeOpsPool(), createPartialCollectors(), true);

    const response = await server.inject({
      method: "GET",
      url: "/v1/ops/status"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "cloudflare_access_required"
    });
  });

  it("returns partial status when collectors are unavailable and audits the read", async () => {
    const pool = new FakeOpsPool();
    const { server } = createTestServer(pool, createPartialCollectors());

    const response = await server.inject({
      method: "GET",
      url: "/v1/ops/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "partial",
      mode: "read_only",
      services: {
        docker: {
          available: false,
          data: null
        },
        cloudflared: {
          available: false,
          data: null
        }
      },
      deploy: {
        git: {
          available: true,
          data: {
            branch: "stage2-api-control-plane",
            commit: "caa809e"
          }
        }
      }
    });
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "ops.read",
        target_type: "ops",
        target_id: "/v1/ops/status",
        metadata: {
          route: "/v1/ops/status",
          mode: "read_only"
        }
      })
    ]);
  });

  it("exposes only read-only ops GET routes", async () => {
    const pool = new FakeOpsPool();
    const collectors = createPartialCollectors();
    const { server } = createTestServer(pool, collectors);

    const services = await server.inject({
      method: "GET",
      url: "/v1/ops/services"
    });
    const system = await server.inject({
      method: "GET",
      url: "/v1/ops/system"
    });
    const deploy = await server.inject({
      method: "GET",
      url: "/v1/ops/deploy"
    });

    expect(services.statusCode).toBe(200);
    expect(system.statusCode).toBe(200);
    expect(deploy.statusCode).toBe(200);
    expect(services.json().mode).toBe("read_only");
    expect(system.json().mode).toBe("read_only");
    expect(deploy.json().mode).toBe("read_only");

    const post = await server.inject({
      method: "POST",
      url: "/v1/ops/status",
      payload: {
        command: "docker restart api"
      }
    });
    expect(post.statusCode).toBe(404);
    expect(pool.audits.map((audit) => audit.target_id)).toEqual([
      "/v1/ops/services",
      "/v1/ops/system",
      "/v1/ops/deploy"
    ]);
  });

  it("reports operator mode and registered access channels without secret values", async () => {
    const { server } = createTestServer(new FakeOpsPool(), createPartialCollectors());

    const response = await server.inject({
      method: "GET",
      url: "/v1/operator/access"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      operator: {
        mode: "lab",
        repoWorkspacePath: "/opt/frank-hub"
      },
      accessProfile: {
        emailConfigured: true,
        mobileConfigured: true,
        whatsappConfigured: true,
        apiKeyNames: ["OPENROUTER_API_KEY", "FRANK_EMAIL_APP_PASSWORD"]
      }
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("+15550000000");
  });

  it("does not pass arbitrary command query params to collectors", async () => {
    const collectors = createPartialCollectors();
    const { server } = createTestServer(new FakeOpsPool(), collectors);

    const response = await server.inject({
      method: "GET",
      url: "/v1/ops/status?command=cat%20.env&args=OPENROUTER_API_KEY"
    });

    expect(response.statusCode).toBe(200);
    expect(collectors.services).toHaveBeenCalledWith();
    expect(collectors.system).toHaveBeenCalledWith();
    expect(collectors.deploy).toHaveBeenCalledWith();
    expect(JSON.stringify(response.json())).not.toContain("OPENROUTER_API_KEY");
  });

  it("reads safe deploy metadata from runtime deploy file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "frank-deploy-"));
    const metadataPath = join(tempDir, "deploy.json");
    await writeFile(
      metadataPath,
      JSON.stringify({
        schemaVersion: 1,
        branch: "stage2-api-control-plane",
        commit: "caa809e",
        deployedAt: "2026-04-28T06:30:00.000Z",
        appVersion: "0.1.0"
      })
    );

    try {
      const deploy = await collectDeploy(metadataPath);

      expect(deploy).toEqual({
        git: {
          available: true,
          data: {
            branch: "stage2-api-control-plane",
            commit: "caa809e",
            appVersion: "0.1.0"
          }
        },
        lastDeploy: {
          available: true,
          data: {
            deployedAt: "2026-04-28T06:30:00.000Z",
            source: "runtime/deploy.json",
            appVersion: "0.1.0"
          }
        }
      });
    } finally {
      await rm(tempDir, {
        recursive: true,
        force: true
      });
    }
  });

  it("returns deploy metadata unavailable cleanly when runtime deploy file is missing", async () => {
    const deploy = await collectDeploy(join(tmpdir(), "frank-missing-deploy.json"));

    expect(deploy).toEqual({
      git: {
        available: false,
        data: null,
        message: "Deploy metadata is not recorded yet."
      },
      lastDeploy: {
        available: false,
        data: null,
        message: "Deploy metadata is not recorded yet."
      }
    });
  });
});

function createTestServer(pool: FakeOpsPool, opsCollectors: OpsCollectors, accessEnabled = false) {
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
        mode: "lab",
        repoWorkspacePath: "/opt/frank-hub",
        allowedWorkspaces: ["/opt/frank-hub", "/opt/frank-hub/workspaces", "/opt/frank-projects"],
        protectedPaths: ["/", "/root", "/opt/frank-backups", "/opt/frank-hub/.env"],
        accessEnvPath: "/opt/frank-hub/runtime/access/frank-access.env"
      },
      accessProfile: {
        emailAddress: "frank@example.com",
        mobileNumber: "+15550000000",
        whatsappNumber: "+15550000000",
        apiKeyNames: ["OPENROUTER_API_KEY", "FRANK_EMAIL_APP_PASSWORD"]
      },
      logLevel: "silent"
    } satisfies ApiConfig,
    pool: pool as never,
    redis: {} as never,
    opsCollectors
  });
  servers.push(server);
  return { server };
}

function createPartialCollectors(): OpsCollectors {
  return {
    services: vi.fn(async () => ({
      docker: {
        available: false,
        data: null,
        message: "Docker unavailable in test runtime."
      },
      cloudflared: {
        available: false,
        data: null,
        message: "cloudflared unavailable in test runtime."
      }
    })),
    system: vi.fn(async () => ({
      host: {
        platform: "linux",
        release: "test",
        arch: "x64",
        uptimeSeconds: 42
      },
      memory: {
        totalBytes: 1024,
        freeBytes: 256,
        usedBytes: 768,
        processRssBytes: 128
      },
      disk: {
        available: false,
        data: null,
        message: "Disk unavailable in test runtime."
      }
    })),
    deploy: vi.fn(async () => ({
      git: {
        available: true,
        data: {
          branch: "stage2-api-control-plane",
          commit: "caa809e",
          appVersion: "0.1.0"
        }
      },
      lastDeploy: {
        available: false,
        data: null,
        message: "Last deploy metadata is not recorded yet."
      }
    }))
  };
}

type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

interface AuditRecord {
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

class FakeOpsPool {
  readonly audits: AuditRecord[] = [];

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

    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        actor_type: values[0] as string,
        actor_id: values[1] as string | null,
        action: values[2] as string,
        target_type: values[3] as string,
        target_id: values[4] as string | null,
        outcome: values[5] as string,
        metadata: JSON.parse(values[6] as string) as Record<string, unknown>
      });
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
