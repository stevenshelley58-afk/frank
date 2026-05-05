import { cleanup, render, screen } from "@testing-library/react";
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
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
