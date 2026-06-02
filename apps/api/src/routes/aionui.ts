import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

interface AionUiStatusResponse {
  configured: boolean;
  running: boolean;
  version: string;
  publicUrl: string;
  internalBaseUrl: string;
  workspaceMounts: string[];
  message?: string;
}

interface AionUiSessionResponse {
  publicUrl: string;
  cookieHeader: string;
}

interface HostOperationResponse {
  ok: boolean;
  action: string;
  message: string;
  output?: string;
  metadata?: Record<string, unknown>;
}

export function registerAionUiRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/aionui/status", async () => {
    if (!isHostAgentConfigured(config)) {
      return defaultStatus(config, "Frank Host Agent is not connected.");
    }
    try {
      return await callHostAgent<AionUiStatusResponse>(config, "/v1/aionui/status");
    } catch {
      return defaultStatus(config, "Frank Host Agent is configured but AionUi status is unavailable.");
    }
  });

  server.post("/v1/aionui/session", async (request, reply) => {
    if (!isHostAgentConfigured(config)) {
      return reply.code(409).send({
        error: "host_agent_not_configured",
        message: "Frank Host Agent is not connected."
      });
    }

    const result = await callHostAgent<AionUiSessionResponse>(config, "/v1/aionui/session", {
      method: "POST"
    });
    const rewrittenCookie = rewriteAionUiCookie(result.cookieHeader, aionUiConfig(config).cookieDomain);
    reply.header("Set-Cookie", rewrittenCookie);
    await auditAionUiOperation(pool, request, "aionui.session.create", "success", {
      publicUrl: result.publicUrl
    });
    return {
      publicUrl: result.publicUrl,
      ready: true
    };
  });

  server.post("/v1/aionui/start", async (request) => {
    const result = await runHostOperation(config, "aionui.start");
    await auditAionUiOperation(pool, request, "aionui.start", result.ok ? "success" : "failure", {
      message: result.message
    });
    return result;
  });

  server.post("/v1/aionui/stop", async (request) => {
    const result = await runHostOperation(config, "aionui.stop");
    await auditAionUiOperation(pool, request, "aionui.stop", result.ok ? "success" : "failure", {
      message: result.message
    });
    return result;
  });

  server.post("/v1/aionui/logs", async () => runHostOperation(config, "aionui.logs"));
}

export async function runHostOperation(config: ApiConfig, operation: string): Promise<HostOperationResponse> {
  if (!isHostAgentConfigured(config)) {
    return {
      ok: false,
      action: operation,
      message: "Frank Host Agent is not connected."
    };
  }
  return callHostAgent<HostOperationResponse>(config, `/v1/ops/${encodeURIComponent(operation)}`, {
    method: "POST"
  });
}

async function callHostAgent<T = unknown>(
  config: ApiConfig,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  if (!config.hostAgent.token) {
    throw new Error("Frank Host Agent token is missing.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.hostAgent.timeoutSeconds * 1000);
  try {
    const init: RequestInit = {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.hostAgent.token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
      }
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${config.hostAgent.baseUrl}${path}`, init);
    const raw = await response.text();
    const parsed = raw ? JSON.parse(raw) as T : ({} as T);
    if (!response.ok) {
      throw new Error(hostAgentErrorMessage(parsed, response.status));
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function defaultStatus(config: ApiConfig, message: string): AionUiStatusResponse {
  const aionui = aionUiConfig(config);
  return {
    configured: aionui.enabled,
    running: false,
    version: aionui.version,
    publicUrl: aionui.publicUrl,
    internalBaseUrl: aionui.internalBaseUrl,
    workspaceMounts: aionui.workspaceMounts,
    message
  };
}

function rewriteAionUiCookie(cookieHeader: string, domain: string): string {
  const [cookiePair] = cookieHeader.split(";");
  if (!cookiePair?.includes("=")) {
    throw new Error("AionUi did not return a session cookie.");
  }
  return `${cookiePair.trim()}; Domain=${domain}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function aionUiConfig(config: ApiConfig) {
  return config.aionui ?? {
    enabled: false,
    version: "2.1.9",
    publicUrl: "https://aionui.frank.fail",
    internalBaseUrl: "http://aionui:25808",
    adminCredentialsPath: "/opt/frank-hub/runtime/access/aionui-admin.json",
    cookieDomain: ".frank.fail",
    workspaceMounts: ["/opt/frank-projects", "/opt/frank-hub/workspaces", "/opt/frank-hub/runtime/artifacts"]
  };
}

function isHostAgentConfigured(config: ApiConfig): boolean {
  return config.hostAgent.enabled && Boolean(config.hostAgent.token);
}

function hostAgentErrorMessage(parsed: unknown, status: number): string {
  if (isRecord(parsed) && typeof parsed.message === "string" && parsed.message.trim()) {
    return parsed.message;
  }
  return `Host Agent returned HTTP ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function auditAionUiOperation(
  pool: PgPool,
  request: FastifyRequest,
  action: string,
  outcome: "success" | "failure",
  metadata: Record<string, unknown>
): Promise<void> {
  await recordAuditEvent(pool, {
    actorType: "user",
    actorId: request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown",
    action,
    targetType: "aionui",
    outcome,
    metadata
  });
}
