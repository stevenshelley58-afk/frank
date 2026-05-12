import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./home.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomePage", () => {
  it("starts the VPS ChatGPT browser and embeds it as the default home surface", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ running: true, url: "/vps-browser/" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<HomePage />);

    const browser = await screen.findByTitle("ChatGPT browser");

    expect(browser.getAttribute("src")).toBe("/vps-browser/");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/browser/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "chatgpt" })
      })
    );
    expect(screen.queryByText("API Chat")).toBeNull();
  });

  it("shows a non-technical setup path when the browser start endpoint is not connected", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({
      running: false,
      configured: false,
      url: "/vps-browser/"
    })));
    const onOpenAiConsole = vi.fn();

    render(<HomePage onOpenAiConsole={onOpenAiConsole} />);

    expect(await screen.findByText("ChatGPT is not connected")).toBeTruthy();
    expect(screen.queryByTitle("ChatGPT browser")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Codex workstation" }));

    expect(onOpenAiConsole).toHaveBeenCalledOnce();
  });

  it("does not embed a stopped browser response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({
      running: false,
      configured: true,
      url: "/vps-browser/",
      message: "Frank Host Agent is configured but unreachable."
    })));

    render(<HomePage />);

    expect(await screen.findByText("ChatGPT did not start")).toBeTruthy();
    expect(screen.queryByTitle("ChatGPT browser")).toBeNull();
  });
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
