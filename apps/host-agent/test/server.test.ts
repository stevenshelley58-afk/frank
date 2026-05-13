import { afterEach, describe, expect, it } from "vitest";
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
    protectedPaths: ["/", "/root"]
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
