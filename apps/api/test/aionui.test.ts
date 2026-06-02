import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("AionUi API routes", () => {
  it("returns AionUi status from the host agent without exposing the token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      configured: true,
      running: true,
      version: "2.1.9",
      publicUrl: "https://aionui.frank.fail",
      internalBaseUrl: "http://aionui:25808",
      workspaceMounts: ["/opt/frank-projects", "/opt/frank-hub/workspaces"]
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer();

    const response = await server.inject({ method: "GET", url: "/v1/aionui/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: true,
      running: true,
      version: "2.1.9",
      publicUrl: "https://aionui.frank.fail",
      workspaceMounts: ["/opt/frank-projects", "/opt/frank-hub/workspaces"]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://host-agent.local/v1/aionui/status",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer host-agent-secret" })
      })
    );
    expect(response.body).not.toContain("host-agent-secret");
  });

  it("creates an AionUi session by logging in server-side and redacts credentials", async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url === "http://host-agent.local/v1/aionui/session") {
        return jsonResponse({
          publicUrl: "https://aionui.frank.fail",
          cookieHeader: "aionui_session=abc123; Path=/; HttpOnly; SameSite=Lax"
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer();

    const response = await server.inject({ method: "POST", url: "/v1/aionui/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      publicUrl: "https://aionui.frank.fail",
      ready: true
    });
    expect(response.headers["set-cookie"]).toEqual(
      "aionui_session=abc123; Domain=.frank.fail; Path=/; HttpOnly; Secure; SameSite=Lax"
    );
    expect(response.body).not.toContain("abc123");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("password");
  });

  it("runs bounded AionUi and project operations through the host agent", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      action: "aionui.start",
      message: "AionUi runtime started."
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer();

    const start = await server.inject({ method: "POST", url: "/v1/aionui/start" });
    const importProjects = await server.inject({ method: "POST", url: "/v1/projects/materialize-c-dev" });

    expect(start.statusCode).toBe(200);
    expect(importProjects.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://host-agent.local/v1/ops/aionui.start",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://host-agent.local/v1/ops/projects.materialize_c_dev",
      expect.objectContaining({ method: "POST" })
    );
  });
});

function createTestServer() {
  const config: ApiConfig = {
    environment: "test",
    systemName: "Frank Hub",
    domain: "frank.fail",
    dashboardUrl: "https://hub.frank.fail",
    apiUrl: "https://api.frank.fail",
    port: 0,
    databaseUrl: "postgres://frank:test@postgres:5432/frank",
    redisUrl: "redis://redis:6379",
    corsOrigins: [],
    cloudflareAccess: { enabled: false, issuer: undefined, audiences: [] },
    openai: { apiKey: undefined, baseUrl: "https://api.openai.com/v1", chatModel: "" },
    openrouterApiKey: undefined,
    hostAgent: {
      enabled: true,
      baseUrl: "http://host-agent.local",
      token: "host-agent-secret",
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
    aionui: {
      enabled: true,
      version: "2.1.9",
      publicUrl: "https://aionui.frank.fail",
      internalBaseUrl: "http://aionui:25808",
      adminCredentialsPath: "/opt/frank-hub/runtime/access/aionui-admin.json",
      cookieDomain: ".frank.fail",
      workspaceMounts: ["/opt/frank-projects", "/opt/frank-hub/workspaces", "/opt/frank-hub/runtime/artifacts"]
    },
    updates: {
      checkEnabled: true,
      checkIntervalMinutes: 60,
      githubRemote: "origin",
      githubBranch: "main"
    },
    backups: { root: "/opt/frank-backups" },
    operator: {
      mode: "lab",
      repoWorkspacePath: "/opt/frank-hub",
      allowedWorkspaces: ["/opt/frank-hub", "/opt/frank-hub/workspaces", "/opt/frank-projects"],
      protectedPaths: ["/", "/root", "/etc", "/opt/frank-backups", "/opt/frank-hub/runtime/access"],
      accessEnvPath: "/opt/frank-hub/runtime/access/frank-access.env",
      secretWriteEnabled: false,
      secretWriteAllowedKeys: [],
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
  };

  const server = buildServer({
    config,
    pool: new FakePool() as never,
    redis: {} as never
  });
  servers.push(server);
  return { server };
}

class FakePool {
  async connect() {
    return {
      query: this.query.bind(this),
      release() {
        return undefined;
      }
    };
  }

  async query<Row = Record<string, unknown>>(): Promise<{ rows: Row[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
