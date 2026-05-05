import { execFile } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { z } from "zod";
import type { HostAgentConfig } from "./config.js";
import { createHostSessionManager, type HostSessionManager } from "./session-manager.js";

const execFileAsync = promisify(execFile);
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

export function createHostAgentServer(input: {
  config: HostAgentConfig;
  manager?: HostSessionManager | undefined;
}) {
  const manager = input.manager ?? createHostSessionManager({ protectedPaths: input.config.protectedPaths });

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
        return sendJson(response, 200, await browserStatus(input.config));
      }
      if (request.method === "POST" && url.pathname === "/v1/browser/start") {
        await runBrowserScript(input.config, "up");
        return sendJson(response, 200, { running: true, url: "/vps-browser/" });
      }
      if (request.method === "POST" && url.pathname === "/v1/browser/stop") {
        await runBrowserScript(input.config, "down");
        return sendJson(response, 200, { running: false, url: "/vps-browser/" });
      }

      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
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

async function browserStatus(_config: HostAgentConfig) {
  try {
    await execFileAsync("docker", ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.browser.yml", "ps", "--status", "running", "browser"], {
      cwd: _config.repoPath
    });
    return { running: true, url: "/vps-browser/" };
  } catch {
    return { running: false, url: "/vps-browser/" };
  }
}

async function runBrowserScript(config: HostAgentConfig, direction: "up" | "down") {
  const script = direction === "up" ? "scripts/browser_up.sh" : "scripts/browser_down.sh";
  await execFileAsync("bash", [script], { cwd: config.repoPath });
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
