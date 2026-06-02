import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { browserTargetUrl, createHostAgentServer } from "../src/server.js";
import type { HostAgentConfig } from "../src/config.js";
import type { HostSession, HostSessionManager } from "../src/session-manager.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

describe("Frank host agent server", () => {
  it("returns validation errors as 400 responses instead of generic host-agent failures", async () => {
    const server = createHostAgentServer({
      config: testConfig(),
      manager: new FakeManager()
    });
    await listen(server);
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/browser/start`, {
      method: "POST",
      headers: {
        Authorization: "Bearer host-agent-secret",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ target: "not-a-browser" })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_request",
      message: "Request validation failed."
    });
  });

  it("maps the Codex browser target to the official Codex app URL", () => {
    expect(browserTargetUrl("codex")).toBe("https://chatgpt.com/codex");
  });

  it("runs only allowlisted production operations", async () => {
    const exec = vi.fn(async () => ({ stdout: "ok\n", stderr: "" }));
    const server = createHostAgentServer({
      config: testConfig(),
      manager: new FakeManager(),
      exec
    });
    await listen(server);
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/ops/aionui.start`, {
      method: "POST",
      headers: {
        Authorization: "Bearer host-agent-secret"
      }
    });
    const missing = await fetch(`http://127.0.0.1:${address.port}/v1/ops/rm -rf /`, {
      method: "POST",
      headers: {
        Authorization: "Bearer host-agent-secret"
      }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      action: "aionui.start"
    });
    expect(missing.status).toBe(404);
    expect(exec).toHaveBeenCalledWith(
      "bash",
      ["scripts/aionui_compose_up.sh"],
      expect.objectContaining({ cwd: "/opt/frank-hub" })
    );
  });

  it("redacts sensitive operation output", async () => {
    const exec = vi.fn(async () => ({ stdout: "FRANK_HOST_AGENT_TOKEN=secret\nok\n", stderr: "" }));
    const server = createHostAgentServer({
      config: testConfig(),
      manager: new FakeManager(),
      exec
    });
    await listen(server);
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/ops/aionui.logs`, {
      method: "POST",
      headers: {
        Authorization: "Bearer host-agent-secret"
      }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.output).toContain("[redacted]");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

function listen(server: Server): Promise<void> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
}

function testConfig(): HostAgentConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "host-agent-secret",
    browserComposeFile: "docker-compose.browser.yml",
    repoPath: "/opt/frank-hub",
    runWild: true,
    protectedPaths: ["/", "/root"],
    aionui: {
      version: "2.1.9",
      publicUrl: "https://aionui.frank.fail",
      hostBaseUrl: "http://127.0.0.1:25808",
      adminCredentialsPath: "/opt/frank-hub/runtime/access/aionui-admin.json",
      workspaceMounts: ["/opt/frank-projects", "/opt/frank-hub/workspaces"]
    }
  };
}

class FakeManager implements HostSessionManager {
  async createSession(): Promise<HostSession> {
    throw new Error("not implemented");
  }

  async listSessions(): Promise<HostSession[]> {
    return [];
  }

  async getSession(): Promise<HostSession> {
    throw new Error("not implemented");
  }

  async sendInput(): Promise<void> {
    throw new Error("not implemented");
  }

  async captureOutput(): Promise<string> {
    return "";
  }

  async stopSession(): Promise<HostSession> {
    throw new Error("not implemented");
  }
}
