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

    expect(await screen.findByText("ChatGPT Browser")).toBeTruthy();
    expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Workspace path")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Start Codex" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ai/sessions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"tool\":\"codex\"")
      })
    ));
    expect((await screen.findAllByText("session-1")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Codex ready in/)).toBeTruthy();

    await user.type(screen.getByLabelText("Terminal input"), "pnpm test");
    await user.click(screen.getByRole("button", { name: "Send Input" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/ai/sessions/session-1/input",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("pnpm test")
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
    await user.click(await screen.findByRole("button", { name: "Open ChatGPT Browser" }));

    const frame = await screen.findByTitle("VPS browser");
    expect(frame.getAttribute("src")).toBe("/vps-browser/");
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
