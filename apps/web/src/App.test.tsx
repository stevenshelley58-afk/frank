import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("opens on the Codex workstation so Frank can be the primary work surface", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/tasks?limit=5")) return response({ tasks: [] });
      if (url.endsWith("/v1/ai/host/status")) return response({
        configured: true,
        reachable: true,
        tools: {
          codex: { installed: true },
          tmux: { installed: true }
        }
      });
      if (url.endsWith("/v1/ai/sessions")) return response({ sessions: [] });
      if (url.endsWith("/v1/projects")) return response({ projects: [] });
      if (url.endsWith("/v1/browser/status")) return response({ running: false, url: "/vps-browser/" });
      return response({});
    }));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Start Codex CLI" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Open Codex App" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Codex Workstation", level: 1 })).toBeTruthy();
    expect(screen.queryByTitle("ChatGPT browser")).toBeNull();
    expect(screen.queryByText("API Chat")).toBeNull();
    expect(screen.queryByText(/OpenAI chat requires OPENAI_API_KEY/)).toBeNull();
    expect(screen.queryByText("How can I help you today?")).toBeNull();
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
