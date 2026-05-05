import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("opens on the VPS AI Console so ChatGPT browser and Codex are the first workflow", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/tasks?limit=5")) return response({ tasks: [] });
      if (url.endsWith("/v1/ai/host/status")) return response({ configured: false, reachable: false, tools: {} });
      if (url.endsWith("/v1/ai/sessions")) return response({ sessions: [] });
      if (url.endsWith("/v1/projects")) return response({ projects: [] });
      if (url.endsWith("/v1/browser/status")) return response({ running: false, url: "/vps-browser/" });
      return response({});
    }));

    render(<App />);

    expect(await screen.findByText("AI Workstation")).toBeTruthy();
    expect(await screen.findByText("ChatGPT Browser")).toBeTruthy();
    expect(screen.queryByText("How can I help you today?")).toBeNull();
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
