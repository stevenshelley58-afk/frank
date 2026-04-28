import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest } from "./api.js";

describe("apiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses same-origin /api paths and encodes query parameters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<{ ok: boolean }>("/v1/tasks", { query: { limit: 10, state: "queued" } })).resolves.toEqual({
      ok: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks?limit=10&state=queued",
      expect.objectContaining({
        method: "GET"
      })
    );
  });

  it("throws typed API errors with backend messages", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_request", message: "Request validation failed." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/v1/tasks")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 400,
      code: "invalid_request",
      message: "Request validation failed."
    } satisfies Partial<ApiClientError>);
  });

  it("falls back to HTTP status when the error body is not JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/v1/ops/status")).rejects.toThrow("Frank API returned HTTP 502");
  });
});
