import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConsolePage } from "./ai-console.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AiConsolePage", () => {
  it("renders subscription-backed AI tools and starts a Codex session", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/ai/host/status")) {
        return response({
          configured: true,
          reachable: true,
          tools: {
            codex: { installed: true },
            claudeCode: { installed: true }
          }
        });
      }
      if (url.endsWith("/v1/ai/sessions") && init?.method === "GET") {
        return response({ sessions: [] });
      }
      if (url.endsWith("/v1/projects")) {
        return response({ projects: [] });
      }
      if (url.endsWith("/v1/browser/status")) {
        return response({ running: false, url: "/vps-browser/" });
      }
      if (url.endsWith("/v1/browser/start") && init?.method === "POST") {
        return response({ running: true, url: "/vps-browser/" });
      }
      if (url.endsWith("/v1/ai/sessions") && init?.method === "POST") {
        return response({
          session: {
            id: "session-1",
            tool: "codex",
            workspacePath: "/opt/frank-hub",
            status: "running",
            createdAt: "2026-05-05T00:00:00.000Z",
            updatedAt: "2026-05-05T00:00:00.000Z"
          }
        });
      }
      if (url.endsWith("/v1/ai/sessions/session-1/output")) {
        return response({ output: "Codex ready in /opt/frank-hub" });
      }
      if (url.endsWith("/v1/ai/sessions/session-1/input") && init?.method === "POST") {
        return response({ ok: true });
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AiConsolePage />);

    expect(await screen.findByRole("button", { name: "Open ChatGPT" })).toBeTruthy();
    expect(screen.queryByText("Open ChatGPT Browser")).toBeNull();
    expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Workspace path")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Codex App" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open ChatGPT app" }).getAttribute("href")).toBe("https://chatgpt.com/");

    await user.click(screen.getByRole("button", { name: "Open Codex App" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/browser/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "codex" })
      })
    ));
    expect(await screen.findByTitle("VPS browser")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Start Codex CLI" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ai/sessions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"tool\":\"codex\"")
      })
    ));
    expect((await screen.findAllByText("session-1")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Codex ready in/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Codex CLI Chat" })).toBeTruthy();

    await user.type(screen.getByLabelText("Message Codex CLI"), "pnpm test");
    await user.click(screen.getByRole("button", { name: "Send Message" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ai/sessions/session-1/input",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("pnpm test")
      })
    ));

    await user.click(screen.getByRole("button", { name: "Send /help" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ai/sessions/session-1/input",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: "/help" })
      })
    ));
  });

  it("embeds the VPS browser inside Frank when started", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/ai/host/status")) return response({ configured: true, reachable: true, tools: {} });
        if (url.endsWith("/v1/ai/sessions")) return response({ sessions: [] });
        if (url.endsWith("/v1/projects")) return response({ projects: [] });
        if (url.endsWith("/v1/browser/status")) return response({ running: false, url: "/vps-browser/" });
        if (url.endsWith("/v1/browser/start") && init?.method === "POST") return response({ running: true, url: "/vps-browser/" });
        return response({});
      })
    );

    render(<AiConsolePage />);
    await user.click(await screen.findByRole("button", { name: "Open ChatGPT" }));

    const frame = await screen.findByTitle("VPS browser");
    expect(frame.getAttribute("src")).toBe("/vps-browser/");
    expect(frame.getAttribute("allow")).toContain("virtual-keyboard");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/browser/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "chatgpt" })
      })
    );
  });

  it("shows action errors inside the AI Console instead of failing silently", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/ai/host/status")) {
          return response({
            configured: true,
            reachable: false,
            tools: {},
            message: "Frank Host Agent is configured but unreachable."
          });
        }
        if (url.endsWith("/v1/ai/sessions") && init?.method === "GET") return response({ sessions: [] });
        if (url.endsWith("/v1/projects")) return response({ projects: [] });
        if (url.endsWith("/v1/browser/status")) return response({ running: false, url: "/vps-browser/" });
        if (url.endsWith("/v1/ai/sessions") && init?.method === "POST") {
          return response(
            {
              error: "host_agent_not_configured",
              message: "Frank's VPS control service is not connected. Run scripts/install_host_agent.sh on the VPS, then redeploy Frank."
            },
            409
          );
        }
        return response({});
      })
    );

    render(<AiConsolePage />);
    expect(await screen.findByText("Frank Host Agent is configured but unreachable.")).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Start Codex CLI" }));

    expect(await screen.findByText("Frank's VPS control service is not connected. Run scripts/install_host_agent.sh on the VPS, then redeploy Frank.")).toBeTruthy();
  });

  it("shows workspace allowlist errors with the blocked path and configured allowlist", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/ai/host/status")) return response({ configured: true, reachable: true, tools: {} });
        if (url.endsWith("/v1/ai/sessions") && init?.method === "GET") return response({ sessions: [] });
        if (url.endsWith("/v1/projects")) return response({ projects: [] });
        if (url.endsWith("/v1/browser/status")) return response({ running: false, url: "/vps-browser/" });
        if (url.endsWith("/v1/ai/sessions") && init?.method === "POST") {
          return response(
            {
              error: "invalid_ai_workspace",
              message: "AI workspace \"/opt/frank-hub\" is outside the configured operator workspace allowlist: /opt/frank-hub/workspaces."
            },
            400
          );
        }
        return response({});
      })
    );

    render(<AiConsolePage />);
    await user.click(await screen.findByRole("button", { name: "Start Codex CLI" }));

    expect(await screen.findByText(/AI workspace "\/opt\/frank-hub"/)).toBeTruthy();
    expect(screen.getByText(/\/opt\/frank-hub\/workspaces/)).toBeTruthy();
  });

  it("does not claim ChatGPT is ready when the browser did not start", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/ai/host/status")) return response({ configured: false, reachable: false, tools: {} });
        if (url.endsWith("/v1/ai/sessions")) return response({ sessions: [] });
        if (url.endsWith("/v1/projects")) return response({ projects: [] });
        if (url.endsWith("/v1/browser/status")) return response({ running: false, url: "/vps-browser/", configured: false });
        if (url.endsWith("/v1/browser/start") && init?.method === "POST") {
          return response({ running: false, url: "/vps-browser/", configured: false });
        }
        return response({});
      })
    );

    render(<AiConsolePage />);
    await user.click(await screen.findByRole("button", { name: "Open ChatGPT" }));

    expect(await screen.findByText("Frank's VPS browser is not connected yet. Run the host agent setup on the VPS, then redeploy.")).toBeTruthy();
    expect(screen.queryByText("ChatGPT is ready in Frank.")).toBeNull();
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
