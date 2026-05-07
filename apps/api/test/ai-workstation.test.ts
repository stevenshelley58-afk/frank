import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("AI workstation API routes", () => {
  it("proxies host status without exposing the host-agent token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      version: "0.1.0",
      tools: {
        codex: { installed: true },
        claudeCode: { installed: false }
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(new FakeAiPool());

    const response = await server.inject({ method: "GET", url: "/v1/ai/host/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: true,
      reachable: true,
      tools: {
        codex: { installed: true },
        claudeCode: { installed: false }
      }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://host-agent.local/v1/status",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer host-agent-secret" })
      })
    );
    expect(response.body).not.toContain("host-agent-secret");
  });

  it("reports host-agent outages as unreachable status instead of breaking the AI console", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(new FakeAiPool());

    const response = await server.inject({ method: "GET", url: "/v1/ai/host/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      configured: true,
      reachable: false,
      tools: {},
      message: "Frank Host Agent is configured but unreachable."
    });
    expect(response.body).not.toContain("host-agent-secret");
  });

  it("starts a Codex session, records it, and rejects protected workspaces", async () => {
    const pool = new FakeAiPool();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      id: "host-session-1",
      sessionName: "frank-codex-host-session-1",
      tool: "codex",
      workspacePath: "/opt/frank-hub",
      status: "running",
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:00:00.000Z"
    })));
    const { server } = createTestServer(pool);

    const protectedResponse = await server.inject({
      method: "POST",
      url: "/v1/ai/sessions",
      payload: {
        tool: "codex",
        workspacePath: "/opt/frank-hub/runtime/access",
        prompt: "read secrets"
      }
    });
    expect(protectedResponse.statusCode).toBe(400);

    const response = await server.inject({
      method: "POST",
      url: "/v1/ai/sessions",
      payload: {
        tool: "codex",
        workspacePath: "/opt/frank-hub",
        prompt: "continue this build"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().session).toMatchObject({
      id: "host-session-1",
      tool: "codex",
      workspacePath: "/opt/frank-hub",
      status: "running"
    });
    expect(pool.sessions).toHaveLength(1);
    expect(JSON.stringify(pool.sessions)).not.toContain("continue this build");
  });

  it("creates a handoff prompt for continuing work in Codex", async () => {
    const pool = new FakeAiPool();
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/ai/handoffs",
      payload: {
        targetTool: "codex",
        title: "Continue Frank workstation build",
        summary: "Implement the AI Console and host agent.",
        workspacePath: "/opt/frank-hub"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().handoff).toMatchObject({
      targetTool: "codex",
      workspacePath: "/opt/frank-hub"
    });
    expect(response.json().handoff.prompt).toContain("Continue Frank workstation build");
    expect(pool.handoffs).toHaveLength(1);
  });

  it("reads terminal output and sends input through the host agent session", async () => {
    const pool = new FakeAiPool();
    pool.sessions.push({
      id: "session-1",
      tool: "codex",
      host_session_id: "host-session-1",
      session_name: "frank-codex-host-session-1",
      workspace_path: "/opt/frank-hub",
      status: "running",
      metadata: {},
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
      stopped_at: null
    });
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/sessions/frank-codex-host-session-1/output")) {
        return jsonResponse({ output: "codex ready" });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(pool);

    const output = await server.inject({
      method: "GET",
      url: "/v1/ai/sessions/session-1/output"
    });
    const input = await server.inject({
      method: "POST",
      url: "/v1/ai/sessions/session-1/input",
      payload: { input: "run pnpm test" }
    });

    expect(output.statusCode).toBe(200);
    expect(output.json()).toEqual({ output: "codex ready" });
    expect(input.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://host-agent.local/v1/sessions/frank-codex-host-session-1/output",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://host-agent.local/v1/sessions/frank-codex-host-session-1/input",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: "run pnpm test" })
      })
    );
  });

  it("proxies browser start and stop through the host agent", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ running: true, url: "/vps-browser/" }));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(new FakeAiPool());

    const started = await server.inject({ method: "POST", url: "/v1/browser/start", payload: { target: "claude" } });
    const stopped = await server.inject({ method: "POST", url: "/v1/browser/stop" });

    expect(started.statusCode).toBe(200);
    expect(stopped.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://host-agent.local/v1/browser/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "claude" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://host-agent.local/v1/browser/stop",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns browser start failures as user-visible browser status instead of HTTP 502", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      error: "host_agent_error",
      message: "Browser service could not start."
    }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(new FakeAiPool());

    const response = await server.inject({ method: "POST", url: "/v1/browser/start", payload: { target: "chatgpt" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      running: false,
      url: "/vps-browser/",
      configured: true,
      message: "Browser service could not start."
    });
  });

  it("summarizes the retired jlesage chrome image failure without exposing Docker noise", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      error: "host_agent_error",
      message: "Command failed: bash scripts/browser_up.sh https://chatgpt.com Image jlesage/chrome:latest Pulling Error response from daemon: pull access denied for jlesage/chrome, repository does not exist or may require 'docker login'"
    }, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(new FakeAiPool());

    const response = await server.inject({ method: "POST", url: "/v1/browser/start", payload: { target: "chatgpt" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      running: false,
      url: "/vps-browser/",
      configured: true,
      message: "Frank's browser image setting is outdated. Use FRANK_BROWSER_IMAGE=jlesage/chromium:latest, then try again."
    });
    expect(response.body).not.toContain("docker login");
  });
});

function createTestServer(pool: FakeAiPool) {
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
    } satisfies ApiConfig,
    pool: pool as never,
    redis: {} as never
  });
  servers.push(server);
  return { server };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

interface SessionRecord {
  id: string;
  tool: string;
  host_session_id: string;
  session_name: string;
  workspace_path: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  stopped_at: string | null;
}

interface HandoffRecord {
  id: string;
  target_tool: string;
  title: string;
  summary: string;
  workspace_path: string;
  prompt: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

class FakeAiPool {
  readonly sessions: SessionRecord[] = [];
  readonly handoffs: HandoffRecord[] = [];
  readonly audits: unknown[] = [];

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
    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }
    if (normalized.startsWith("insert into ai_tool_sessions")) {
      const record: SessionRecord = {
        id: values[0] as string,
        tool: values[1] as string,
        host_session_id: values[2] as string,
        session_name: values[3] as string,
        workspace_path: values[4] as string,
        status: values[5] as string,
        metadata: JSON.parse(values[6] as string) as Record<string, unknown>,
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z",
        stopped_at: null
      };
      this.sessions.push(record);
      return rows([record] as Row[]);
    }
    if (normalized.startsWith("select") && normalized.includes("from ai_tool_sessions")) {
      return rows(this.sessions as Row[]);
    }
    if (normalized.startsWith("update ai_tool_sessions")) {
      const id = values[0] as string;
      const status = values[1] as string;
      const session = this.sessions.find((item) => item.id === id);
      if (session) {
        session.status = status;
        session.updated_at = "2026-05-05T00:00:01.000Z";
        session.stopped_at = "2026-05-05T00:00:01.000Z";
        return rows([session] as Row[]);
      }
      return rows([]);
    }
    if (normalized.startsWith("insert into ai_handoffs")) {
      const record: HandoffRecord = {
        id: values[0] as string,
        target_tool: values[1] as string,
        title: values[2] as string,
        summary: values[3] as string,
        workspace_path: values[4] as string,
        prompt: values[5] as string,
        metadata: JSON.parse(values[6] as string) as Record<string, unknown>,
        created_at: "2026-05-05T00:00:00.000Z"
      };
      this.handoffs.push(record);
      return rows([record] as Row[]);
    }
    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push(values);
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
