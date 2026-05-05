import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("opens on Home with the ChatGPT browser ready instead of task or API chat", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/tasks?limit=5")) return response({ tasks: [] });
      if (url.endsWith("/v1/browser/start")) return response({ running: true, url: "/vps-browser/" });
      return response({});
    }));

    render(<App />);

    expect(await screen.findByTitle("ChatGPT browser")).toBeTruthy();
    expect(screen.queryByText("AI Workstation")).toBeNull();
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
