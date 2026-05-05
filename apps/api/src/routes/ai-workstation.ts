import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const aiToolSchema = z.enum(["codex", "claude_code"]);

const createSessionSchema = z
  .object({
    tool: aiToolSchema,
    workspacePath: z.string().trim().min(1),
    prompt: z.string().trim().max(20_000).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

const createHandoffSchema = z
  .object({
    targetTool: aiToolSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(20_000),
    workspacePath: z.string().trim().min(1),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

const sessionInputSchema = z
  .object({
    input: z.string().min(1).max(10_000)
  })
  .strict();

const browserStartSchema = z
  .object({
    target: z.enum(["chatgpt", "claude"]).optional()
  })
  .strict();

interface AiToolSessionRow {
  id: string;
  tool: "codex" | "claude_code";
  host_session_id: string;
  session_name: string;
  workspace_path: string;
  status: "running" | "stopped" | "failed";
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
  stopped_at: Date | string | null;
}

interface AiHandoffRow {
  id: string;
  target_tool: "codex" | "claude_code";
  title: string;
  summary: string;
  workspace_path: string;
  prompt: string;
  metadata: Record<string, unknown>;
  created_at: Date | string;
}

interface HostSessionResponse {
  id: string;
  sessionName: string;
  tool: "codex" | "claude_code";
  workspacePath: string;
  status: "running" | "stopped" | "failed";
  createdAt: string;
  updatedAt: string;
}

export function registerAiWorkstationRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/ai/host/status", async (request, reply) => {
    if (!isHostAgentConfigured(config)) {
      return {
        configured: false,
        reachable: false,
        tools: {},
        message: "FRANK_HOST_AGENT_ENABLED and FRANK_HOST_AGENT_TOKEN are required."
      };
    }
    let result: Record<string, unknown>;
    try {
      result = await callHostAgent<Record<string, unknown>>(config, "/v1/status");
    } catch {
      return {
        configured: true,
        reachable: false,
        tools: {},
        message: hostAgentUnavailableMessage()
      };
    }
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId: getRequestActorId(request),
      action: "ai.host.status",
      targetType: "host_agent",
      outcome: "success",
      metadata: {}
    });
    return {
      configured: true,
      reachable: true,
      ...result
    };
  });

  server.get("/v1/ai/sessions", async () => {
    const result = await pool.query<AiToolSessionRow>(
      `
        select ${sessionColumns}
        from ai_tool_sessions
        order by updated_at desc, created_at desc
      `
    );
    return { sessions: result.rows.map(serializeSession) };
  });

  server.post("/v1/ai/sessions", async (request, reply) => {
    const body = createSessionSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }
    if (!isHostAgentConfigured(config)) {
      return reply.code(409).send({
        error: "host_agent_not_configured",
        message: "Frank Host Agent is not configured."
      });
    }

    const workspacePath = normalizeOperatorPath(body.data.workspacePath);
    const workspaceCheck = validateWorkspacePath(workspacePath, config);
    if (!workspaceCheck.ok) {
      return reply.code(400).send({
        error: "invalid_ai_workspace",
        message: workspaceCheck.message
      });
    }

    let hostSession: HostSessionResponse;
    try {
      hostSession = await callHostAgent<HostSessionResponse>(config, "/v1/sessions", {
        method: "POST",
        body: {
          tool: body.data.tool,
          workspacePath,
          prompt: body.data.prompt
        }
      });
    } catch {
      return reply.code(502).send({
        error: "host_agent_unreachable",
        message: hostAgentUnavailableMessage()
      });
    }

    const id = hostSession.id;
    const inserted = await pool.query<AiToolSessionRow>(
      `
        insert into ai_tool_sessions (
          id,
          tool,
          host_session_id,
          session_name,
          workspace_path,
          status,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        returning ${sessionColumns}
      `,
      [
        id,
        body.data.tool,
        hostSession.id,
        hostSession.sessionName,
        workspacePath,
        hostSession.status,
        JSON.stringify({
          ...(body.data.metadata ?? {}),
          source: "frank_ai_console"
        })
      ]
    );
    const session = requireRow(inserted.rows[0], "AI session insert did not return a row.");
    await recordAuditEvent(pool, {
      actorType: "user",
      actorId: getRequestActorId(request),
      action: "ai.session.create",
      targetType: "ai_tool_session",
      targetId: session.id,
      outcome: "success",
      metadata: {
        tool: session.tool,
        workspacePath: session.workspace_path
      }
    });
    return reply.code(201).send({ session: serializeSession(session) });
  });

  server.get("/v1/ai/sessions/:id", async (request, reply) => {
    const id = idParam(request);
    const result = await pool.query<AiToolSessionRow>(
      `
        select ${sessionColumns}
        from ai_tool_sessions
        where id = $1
      `,
      [id]
    );
    const row = result.rows[0];
    if (!row) {
      return reply.code(404).send({ error: "ai_session_not_found" });
    }
    return { session: serializeSession(row) };
  });

  server.get("/v1/ai/sessions/:id/output", async (request, reply) => {
    if (!isHostAgentConfigured(config)) {
      return reply.code(409).send({
        error: "host_agent_not_configured",
        message: "Frank Host Agent is not configured."
      });
    }
    const row = await findSession(pool, idParam(request));
    if (!row) {
      return reply.code(404).send({ error: "ai_session_not_found" });
    }
    const result = await callHostAgent<{ output: string }>(
      config,
      `/v1/sessions/${encodeURIComponent(hostAgentRouteSessionId(row))}/output`
    );
    return { output: result.output ?? "" };
  });

  server.post("/v1/ai/sessions/:id/input", async (request, reply) => {
    if (!isHostAgentConfigured(config)) {
      return reply.code(409).send({
        error: "host_agent_not_configured",
        message: "Frank Host Agent is not configured."
      });
    }
    const body = sessionInputSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }
    const row = await findSession(pool, idParam(request));
    if (!row) {
      return reply.code(404).send({ error: "ai_session_not_found" });
    }
    await callHostAgent(config, `/v1/sessions/${encodeURIComponent(hostAgentRouteSessionId(row))}/input`, {
      method: "POST",
      body: { input: body.data.input }
    });
    return { ok: true };
  });

  server.post("/v1/ai/sessions/:id/stop", async (request, reply) => {
    const id = idParam(request);
    const current = await pool.query<AiToolSessionRow>(
      `
        select ${sessionColumns}
        from ai_tool_sessions
        where id = $1
      `,
      [id]
    );
    const row = current.rows[0];
    if (!row) {
      return reply.code(404).send({ error: "ai_session_not_found" });
    }
    if (isHostAgentConfigured(config)) {
      await callHostAgent(config, `/v1/sessions/${encodeURIComponent(hostAgentRouteSessionId(row))}/stop`, {
        method: "POST"
      });
    }
    const updated = await pool.query<AiToolSessionRow>(
      `
        update ai_tool_sessions
        set status = $2, stopped_at = now(), updated_at = now()
        where id = $1
        returning ${sessionColumns}
      `,
      [id, "stopped"]
    );
    return { session: serializeSession(requireRow(updated.rows[0], "AI session update did not return a row.")) };
  });

  server.post("/v1/ai/handoffs", async (request, reply) => {
    const body = createHandoffSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }

    const workspacePath = normalizeOperatorPath(body.data.workspacePath);
    const workspaceCheck = validateWorkspacePath(workspacePath, config);
    if (!workspaceCheck.ok) {
      return reply.code(400).send({
        error: "invalid_ai_workspace",
        message: workspaceCheck.message
      });
    }

    const prompt = buildHandoffPrompt(body.data);
    const id = randomUUID();
    const inserted = await pool.query<AiHandoffRow>(
      `
        insert into ai_handoffs (
          id,
          target_tool,
          title,
          summary,
          workspace_path,
          prompt,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        returning ${handoffColumns}
      `,
      [
        id,
        body.data.targetTool,
        body.data.title,
        body.data.summary,
        workspacePath,
        prompt,
        JSON.stringify(body.data.metadata ?? {})
      ]
    );
    const handoff = requireRow(inserted.rows[0], "AI handoff insert did not return a row.");
    return reply.code(201).send({ handoff: serializeHandoff(handoff) });
  });

  server.get("/v1/browser/status", async () => {
    if (!isHostAgentConfigured(config)) {
      return { running: false, url: "/vps-browser/", configured: false };
    }
    try {
      return await callHostAgent(config, "/v1/browser/status");
    } catch {
      return {
        running: false,
        url: "/vps-browser/",
        configured: true,
        message: hostAgentUnavailableMessage()
      };
    }
  });

  server.post("/v1/browser/start", async (request, reply) => {
    const body = browserStartSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return sendValidationError(reply, body.error);
    }
    if (!isHostAgentConfigured(config)) {
      return {
        running: false,
        url: "/vps-browser/",
        configured: false
      };
    }
    try {
      return await callHostAgent(config, "/v1/browser/start", {
        method: "POST",
        body: body.data.target ? { target: body.data.target } : undefined
      });
    } catch {
      return reply.code(502).send({
        error: "host_agent_unreachable",
        message: hostAgentUnavailableMessage()
      });
    }
  });

  server.post("/v1/browser/stop", async (_request, reply) => {
    if (!isHostAgentConfigured(config)) {
      return {
        running: false,
        url: "/vps-browser/",
        configured: false
      };
    }
    try {
      return await callHostAgent(config, "/v1/browser/stop", { method: "POST" });
    } catch {
      return reply.code(502).send({
        error: "host_agent_unreachable",
        message: hostAgentUnavailableMessage()
      });
    }
  });
}

async function findSession(pool: PgPool, id: string): Promise<AiToolSessionRow | undefined> {
  const result = await pool.query<AiToolSessionRow>(
    `
      select ${sessionColumns}
      from ai_tool_sessions
      where id = $1
    `,
    [id]
  );
  return result.rows[0];
}

const sessionColumns = `
  id,
  tool,
  host_session_id,
  session_name,
  workspace_path,
  status,
  metadata,
  created_at,
  updated_at,
  stopped_at
`;

const handoffColumns = `
  id,
  target_tool,
  title,
  summary,
  workspace_path,
  prompt,
  metadata,
  created_at
`;

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
      throw new Error(`Host Agent returned HTTP ${response.status}.`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function isHostAgentConfigured(config: ApiConfig): boolean {
  return config.hostAgent.enabled && Boolean(config.hostAgent.token);
}

function validateWorkspacePath(workspacePath: string, config: ApiConfig): { ok: true } | { ok: false; message: string } {
  if (isInsideAnyOperatorPath(workspacePath, config.operator.protectedPaths)) {
    return { ok: false, message: "AI workspace is inside a protected Frank path." };
  }
  if (!isInsideAnyOperatorPath(workspacePath, config.operator.allowedWorkspaces)) {
    return { ok: false, message: "AI workspace is outside the configured operator workspace allowlist." };
  }
  return { ok: true };
}

function buildHandoffPrompt(input: z.infer<typeof createHandoffSchema>): string {
  return [
    `# ${input.title}`,
    "",
    `Workspace: ${normalizeOperatorPath(input.workspacePath)}`,
    `Target tool: ${input.targetTool}`,
    "",
    "## Context",
    input.summary,
    "",
    "Use AGENTS.md, CONTEXT.md, and docs/adr as the authoritative project instructions. Work inside the selected VPS workspace."
  ].join("\n");
}

function serializeSession(row: AiToolSessionRow) {
  return {
    id: row.id,
    tool: row.tool,
    hostSessionId: row.host_session_id,
    sessionName: row.session_name,
    workspacePath: row.workspace_path,
    status: row.status,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at),
    stoppedAt: serializeNullableTimestamp(row.stopped_at)
  };
}

function serializeHandoff(row: AiHandoffRow) {
  return {
    id: row.id,
    targetTool: row.target_tool,
    title: row.title,
    summary: row.summary,
    workspacePath: row.workspace_path,
    prompt: row.prompt,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at)
  };
}

function hostAgentRouteSessionId(row: AiToolSessionRow): string {
  return row.session_name || row.host_session_id;
}

function hostAgentUnavailableMessage(): string {
  return "Frank Host Agent is configured but unreachable.";
}

function idParam(request: FastifyRequest): string {
  const params = request.params as { id?: string };
  return params.id ?? "";
}

function isInsideAnyOperatorPath(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => isInsideOperatorPath(candidate, root));
}

function isInsideOperatorPath(candidate: string, root: string): boolean {
  const normalizedRoot = normalizeOperatorPath(root);
  if (normalizedRoot === "/") {
    return candidate === "/";
  }
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}

function normalizeOperatorPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}

function requireRow<Row>(row: Row | undefined, message: string): Row {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    message: "Request validation failed.",
    details: error.flatten()
  });
}

function getRequestActorId(request: FastifyRequest): string {
  return request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown";
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeNullableTimestamp(value: Date | string | null): string | null {
  return value ? serializeTimestamp(value) : null;
}
