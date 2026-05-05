import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AiTool = "codex" | "claude_code";

export interface HostSession {
  id: string;
  sessionName: string;
  tool: AiTool;
  workspacePath: string;
  status: "running" | "stopped" | "failed";
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface HostRunner {
  startSession(input: { sessionName: string; workspacePath: string; command: string[] }): Promise<void>;
  sendInput(sessionName: string, input: string): Promise<void>;
  captureOutput(sessionName: string): Promise<string>;
  stopSession(sessionName: string): Promise<void>;
}

export interface CreateHostSessionInput {
  tool: AiTool;
  workspacePath: string;
  prompt?: string | undefined;
}

export interface HostSessionManager {
  createSession(input: CreateHostSessionInput): Promise<HostSession>;
  listSessions(): Promise<HostSession[]>;
  getSession(id: string): Promise<HostSession>;
  sendInput(id: string, input: string): Promise<void>;
  captureOutput(id: string): Promise<string>;
  stopSession(id: string): Promise<HostSession>;
}

export function buildToolCommand(input: { tool: AiTool; prompt?: string | undefined }): string[] {
  const prompt = input.prompt?.trim();
  if (input.tool === "codex") {
    return prompt ? ["codex", prompt] : ["codex"];
  }
  return prompt ? ["claude", prompt] : ["claude"];
}

export function createHostSessionManager(input: {
  runner?: HostRunner | undefined;
  protectedPaths?: string[] | undefined;
}): HostSessionManager {
  const runner = input.runner ?? new TmuxRunner();
  const protectedPaths = input.protectedPaths ?? defaultProtectedPaths;
  const sessions = new Map<string, HostSession>();

  function requireSession(id: string): HostSession {
    const session = sessions.get(id);
    if (!session) {
      throw new Error("AI session was not found.");
    }
    return session;
  }

  return {
    async createSession(request) {
      const workspacePath = normalizeWorkspacePath(request.workspacePath);
      if (isProtectedWorkspace(workspacePath, protectedPaths)) {
        throw new Error("Workspace is inside a protected VPS path.");
      }

      const id = randomUUID();
      const sessionName = `frank-${request.tool.replace(/_/g, "-")}-${id.slice(0, 8)}`;
      const now = new Date().toISOString();
      const session: HostSession = {
        id,
        sessionName,
        tool: request.tool,
        workspacePath,
        status: "running",
        createdAt: now,
        updatedAt: now,
        error: null
      };
      await runner.startSession({
        sessionName,
        workspacePath,
        command: buildToolCommand(request)
      });
      sessions.set(id, session);
      return session;
    },

    async listSessions() {
      return [...sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async getSession(id) {
      return requireSession(id);
    },

    async sendInput(id, text) {
      const session = requireSession(id);
      await runner.sendInput(session.sessionName, text);
      session.updatedAt = new Date().toISOString();
    },

    async captureOutput(id) {
      const session = requireSession(id);
      return runner.captureOutput(session.sessionName);
    },

    async stopSession(id) {
      const session = requireSession(id);
      await runner.stopSession(session.sessionName);
      session.status = "stopped";
      session.updatedAt = new Date().toISOString();
      return session;
    }
  };
}

export function normalizeWorkspacePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}

export function isProtectedWorkspace(workspacePath: string, protectedPaths: readonly string[]): boolean {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  return protectedPaths.some((root) => isInsidePath(normalizedPath, root));
}

function isInsidePath(candidate: string, root: string): boolean {
  const normalizedRoot = normalizeWorkspacePath(root);
  if (normalizedRoot === "/") {
    return candidate === "/";
  }
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}

export class TmuxRunner implements HostRunner {
  async startSession(input: { sessionName: string; workspacePath: string; command: string[] }): Promise<void> {
    await execFileAsync("tmux", [
      "new-session",
      "-d",
      "-s",
      input.sessionName,
      "-c",
      input.workspacePath,
      shellCommand(input.command)
    ]);
  }

  async sendInput(sessionName: string, input: string): Promise<void> {
    await execFileAsync("tmux", ["send-keys", "-t", sessionName, input, "Enter"]);
  }

  async captureOutput(sessionName: string): Promise<string> {
    const { stdout } = await execFileAsync("tmux", ["capture-pane", "-pt", sessionName, "-S", "-2000"]);
    return stdout;
  }

  async stopSession(sessionName: string): Promise<void> {
    await execFileAsync("tmux", ["kill-session", "-t", sessionName]);
  }
}

function shellCommand(command: string[]): string {
  return command.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const defaultProtectedPaths = [
  "/",
  "/root",
  "/etc",
  "/boot",
  "/var/lib/docker",
  "/var/lib/postgresql",
  "/opt/frank-backups",
  "/opt/frank-hub/.env",
  "/opt/frank-hub/runtime/access",
  "/opt/frank-hub/runtime/hermes/.env",
  "/opt/frank-hub/runtime/hermes/platforms/whatsapp/session"
];
