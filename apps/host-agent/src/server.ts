import { execFile, type ExecFileOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { z } from "zod";
import type { HostAgentConfig } from "./config.js";
import { createHostSessionManager, type HostSessionManager } from "./session-manager.js";

const execFileAsync = promisify(execFile);
type HostExec = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions
) => Promise<{ stdout: string | Buffer; stderr?: string | Buffer }>;
const createSessionSchema = z
  .object({
    tool: z.enum(["codex", "claude_code"]),
    workspacePath: z.string().trim().min(1),
    prompt: z.string().trim().optional()
  })
  .strict();

const sessionInputSchema = z
  .object({
    input: z.string().min(1)
  })
  .strict();

const browserStartSchema = z
  .object({
    target: z.enum(["chatgpt", "claude", "codex"]).optional()
  })
  .strict();

type BrowserTarget = z.infer<typeof browserStartSchema>["target"];

const operationSchema = z
  .object({
    branch: z.string().trim().min(1).max(160).optional()
  })
  .strict();

const allowedOperations = new Set([
  "aionui.start",
  "aionui.stop",
  "aionui.logs",
  "hermes.start",
  "hermes.stop",
  "hermes.logs",
  "projects.import_c_dev",
  "projects.materialize_c_dev",
  "frank.healthcheck",
  "frank.check_latest",
  "frank.deploy_branch"
]);

export function createHostAgentServer(input: {
  config: HostAgentConfig;
  manager?: HostSessionManager | undefined;
  exec?: HostExec | undefined;
}) {
  const manager = input.manager ?? createHostSessionManager({ protectedPaths: input.config.protectedPaths });
  const exec = input.exec ?? defaultExec;

  return http.createServer(async (request, response) => {
    try {
      if (!isAuthorized(request, input.config.token)) {
        return sendJson(response, 401, { error: "unauthorized" });
      }

      const url = new URL(request.url ?? "/", "http://frank-host-agent.local");
      if (request.method === "GET" && url.pathname === "/v1/status") {
        return sendJson(response, 200, await status(input.config));
      }
      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        return sendJson(response, 200, { sessions: await manager.listSessions() });
      }
      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const body = createSessionSchema.parse(await readJson(request));
        return sendJson(response, 201, await manager.createSession(body));
      }

      const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/([^/]+))?$/);
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]!);
        const action = sessionMatch[2];
        if (request.method === "GET" && !action) {
          return sendJson(response, 200, await manager.getSession(sessionId));
        }
        if (request.method === "POST" && action === "input") {
          const body = sessionInputSchema.parse(await readJson(request));
          await manager.sendInput(sessionId, body.input);
          return sendJson(response, 200, { ok: true });
        }
        if (request.method === "GET" && action === "output") {
          return sendJson(response, 200, { output: await manager.captureOutput(sessionId) });
        }
        if (request.method === "POST" && action === "stop") {
          return sendJson(response, 200, await manager.stopSession(sessionId));
        }
      }

      if (request.method === "GET" && url.pathname === "/v1/browser/status") {
        return sendJson(response, 200, await browserStatus(input.config, exec));
      }
      if (request.method === "POST" && url.pathname === "/v1/browser/start") {
        const body = browserStartSchema.parse(await readJson(request));
        await runBrowserScript(input.config, "up", body.target, exec);
        return sendJson(response, 200, { running: true, url: "/vps-browser/" });
      }
      if (request.method === "POST" && url.pathname === "/v1/browser/stop") {
        await runBrowserScript(input.config, "down", undefined, exec);
        return sendJson(response, 200, { running: false, url: "/vps-browser/" });
      }

      if (request.method === "GET" && url.pathname === "/v1/aionui/status") {
        return sendJson(response, 200, await aionUiStatus(input.config, exec));
      }
      if (request.method === "POST" && url.pathname === "/v1/aionui/session") {
        return sendJson(response, 200, await createAionUiSession(input.config));
      }

      const operationMatch = url.pathname.match(/^\/v1\/ops\/([^/]+)$/);
      if (request.method === "POST" && operationMatch) {
        const action = decodeURIComponent(operationMatch[1]!);
        if (!allowedOperations.has(action)) {
          return sendJson(response, 404, { error: "operation_not_found" });
        }
        const body = operationSchema.parse(await readJson(request));
        return sendJson(response, 200, await runOperation(input.config, action, body, exec));
      }

      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendJson(response, 400, {
          error: "invalid_request",
          message: "Request validation failed.",
          details: error.flatten()
        });
      }
      if (error instanceof SyntaxError) {
        return sendJson(response, 400, {
          error: "invalid_json",
          message: "Request body must be valid JSON."
        });
      }
      return sendJson(response, 500, {
        error: "host_agent_error",
        message: error instanceof Error ? error.message : "Host agent failed."
      });
    }
  });
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function status(config: HostAgentConfig) {
  const [tmux, git, docker, codex, claude] = await Promise.all([
    commandInstalled("tmux"),
    commandInstalled("git"),
    commandInstalled("docker"),
    commandInstalled("codex"),
    commandInstalled("claude")
  ]);
  return {
    ok: true,
    version: "0.1.0",
    runWild: config.runWild,
    tools: {
      tmux,
      git,
      docker,
      codex,
      claudeCode: claude
    }
  };
}

async function commandInstalled(command: string) {
  try {
    const { stdout } = await execFileAsync("sh", ["-lc", `command -v ${command}`]);
    return { installed: true, path: stdout.trim() };
  } catch {
    return { installed: false, path: null };
  }
}

async function browserStatus(_config: HostAgentConfig, exec: HostExec = defaultExec) {
  try {
    const { stdout } = await exec("docker", [
      "compose",
      "-f",
      "docker-compose.yml",
      "-f",
      _config.browserComposeFile,
      "ps",
      "--status",
      "running",
      "--services",
      "browser"
    ], {
      cwd: _config.repoPath
    });
    return { running: stdout.toString().trim().split(/\s+/).includes("browser"), url: "/vps-browser/" };
  } catch {
    return { running: false, url: "/vps-browser/" };
  }
}

async function runBrowserScript(
  config: HostAgentConfig,
  direction: "up" | "down",
  target?: BrowserTarget,
  exec: HostExec = defaultExec
) {
  const script = direction === "up" ? "scripts/browser_up.sh" : "scripts/browser_down.sh";
  const targetUrl = browserTargetUrl(target);
  await exec("bash", targetUrl ? [script, targetUrl] : [script], { cwd: config.repoPath });
}

async function aionUiStatus(config: HostAgentConfig, exec: HostExec) {
  const running = await composeServiceRunning(config, "docker-compose.aionui.yml", "aionui", exec);
  return {
    configured: existsSync(config.aionui.adminCredentialsPath),
    running,
    version: config.aionui.version,
    publicUrl: config.aionui.publicUrl,
    internalBaseUrl: config.aionui.hostBaseUrl,
    workspaceMounts: config.aionui.workspaceMounts,
    message: running ? "AionUi is running." : "AionUi is stopped."
  };
}

async function createAionUiSession(config: HostAgentConfig) {
  const credentials = await readAionUiCredentials(config.aionui.adminCredentialsPath);
  // AionUi's WebUI login endpoint is POST /login with a JSON { username, password }
  // body. On success it returns { success: true, token } AND a Set-Cookie for the
  // session. See iOfficeAI/AionUi src/process/webserver/routes/authRoutes.ts.
  const response = await fetch(`${config.aionui.hostBaseUrl}/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password
    })
  });
  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`AionUi login returned HTTP ${response.status}.`);
  }
  const cookieHeader = buildAionUiCookieHeader({
    cookieName: config.aionui.cookieName,
    body: rawBody,
    setCookieHeader: response.headers.get("set-cookie")
  });
  return {
    publicUrl: config.aionui.publicUrl,
    cookieHeader
  };
}

/**
 * Build the AionUi session cookie header from a /login response.
 *
 * Prefers the JWT returned in the JSON body (`token`), which is the most reliable
 * signal, and falls back to the upstream Set-Cookie header. The API layer
 * re-scopes this cookie to the Frank cookie domain before returning it to the
 * browser. Exported for unit testing.
 */
export function buildAionUiCookieHeader(input: {
  cookieName: string;
  body: string;
  setCookieHeader: string | null;
}): string {
  let parsed: { success?: unknown; token?: unknown } | null = null;
  try {
    parsed = JSON.parse(input.body) as { success?: unknown; token?: unknown };
  } catch {
    parsed = null;
  }

  if (parsed && parsed.success === false) {
    throw new Error("AionUi rejected the stored admin credentials. Reset them and retry.");
  }

  const token = typeof parsed?.token === "string" && parsed.token.trim() ? parsed.token.trim() : null;
  if (token) {
    return `${input.cookieName}=${token}`;
  }

  if (input.setCookieHeader) {
    const [cookiePair] = input.setCookieHeader.split(";");
    if (cookiePair && cookiePair.includes("=")) {
      return cookiePair.trim();
    }
  }

  throw new Error("AionUi login did not return a session token or cookie.");
}

async function readAionUiCredentials(path: string): Promise<{ username: string; password: string }> {
  const raw = await readFile(path, "utf8").catch(() => {
    throw new Error("AionUi admin credentials are not available yet. Start AionUi and wait for first-run bootstrap.");
  });
  const parsed = JSON.parse(raw) as { username?: unknown; password?: unknown };
  if (typeof parsed.username !== "string" || typeof parsed.password !== "string" || !parsed.password.trim()) {
    throw new Error("AionUi admin credentials file is invalid.");
  }
  return {
    username: parsed.username,
    password: parsed.password
  };
}

async function runOperation(
  config: HostAgentConfig,
  action: string,
  body: { branch?: string | undefined },
  exec: HostExec
) {
  const command = operationCommand(action, body);
  const { stdout, stderr } = await exec(command.file, command.args, {
    cwd: config.repoPath,
    timeout: command.timeoutMs,
    windowsHide: true
  });
  const output = redactSensitiveOutput(`${bufferText(stdout)}${bufferText(stderr) ? `\n${bufferText(stderr)}` : ""}`);
  return {
    ok: true,
    action,
    message: operationSuccessMessage(action),
    output
  };
}

function operationCommand(action: string, body: { branch?: string | undefined }): {
  file: string;
  args: string[];
  timeoutMs: number;
} {
  switch (action) {
    case "aionui.start":
      return bashScript("scripts/aionui_compose_up.sh");
    case "aionui.stop":
      return bashScript("scripts/aionui_compose_down.sh");
    case "aionui.logs":
      return bashScript("scripts/aionui_logs.sh");
    case "hermes.start":
      return bashScript("scripts/hermes_compose_up.sh");
    case "hermes.stop":
      return bashScript("scripts/hermes_compose_down.sh");
    case "hermes.logs":
      return bashScript("scripts/hermes_logs.sh");
    case "projects.import_c_dev":
      return bashScript("scripts/import_c_dev_projects.sh", ["--apply"], 300_000);
    case "projects.materialize_c_dev":
      return bashScript("scripts/materialize_c_dev_projects.sh", ["--apply"], 900_000);
    case "frank.healthcheck":
      return bashScript("scripts/healthcheck.sh");
    case "frank.check_latest":
      return bashScript("scripts/check_latest_frank.sh");
    case "frank.deploy_branch":
      return bashScript("scripts/deploy_from_github.sh", [safeBranch(body.branch)], 1_800_000);
    default:
      throw new Error("Unsupported host operation.");
  }
}

function bashScript(script: string, args: string[] = [], timeoutMs = 120_000) {
  return {
    file: "bash",
    args: [script, ...args],
    timeoutMs
  };
}

function safeBranch(value: string | undefined): string {
  const branch = value?.trim();
  if (!branch || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    throw new Error("Deploy branch name is invalid.");
  }
  return branch;
}

async function composeServiceRunning(
  config: HostAgentConfig,
  composeFile: string,
  service: string,
  exec: HostExec
): Promise<boolean> {
  try {
    const { stdout } = await exec("docker", [
      "compose",
      "-f",
      "docker-compose.yml",
      "-f",
      composeFile,
      "ps",
      "--status",
      "running",
      "--services",
      service
    ], {
      cwd: config.repoPath,
      windowsHide: true
    });
    return bufferText(stdout).trim().split(/\s+/).includes(service);
  } catch {
    return false;
  }
}

function operationSuccessMessage(action: string): string {
  if (action === "aionui.start") return "AionUi runtime started.";
  if (action === "aionui.stop") return "AionUi runtime stopped.";
  if (action === "projects.materialize_c_dev") return "C:\\Dev project workspaces materialized.";
  if (action === "projects.import_c_dev") return "C:\\Dev project inventory imported.";
  return "Operation completed.";
}

function redactSensitiveOutput(value: string): string {
  return value
    .replace(/([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*=)[^\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]");
}

function bufferText(value: string | Buffer | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

const defaultExec: HostExec = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, [...args], options);
  return { stdout, stderr };
};

export function browserTargetUrl(target: BrowserTarget): string | undefined {
  if (target === "chatgpt") {
    return "https://chatgpt.com";
  }
  if (target === "codex") {
    return "https://chatgpt.com/codex";
  }
  if (target === "claude") {
    return "https://claude.ai";
  }
  return undefined;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
