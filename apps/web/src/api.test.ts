import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiRequest,
  createFilesBackup,
  fetchSystemStatus,
  getArtifactDownloadUrl,
  listTaskLogs,
  runBackupPreflight,
  runHermesKillSwitch,
  runTaskWithHermes,
  stopTaskHermes
} from "./api.js";

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

  it("fetches system status from same-origin API", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          systemName: "Frank Hub",
          environment: "test",
          dashboardUrl: "https://hub.frank.fail",
          apiUrl: "https://api.frank.fail",
          generatedAt: "2026-04-30T00:00:00.000Z",
          services: {
            postgres: { ok: true },
            redis: { ok: true },
            cloudflareAccess: { ok: true }
          },
          modelControlPlane: {
            roleCount: 1,
            providerCount: 1,
            routingMode: "role_based_skeleton"
          },
          opsConsole: {
            mode: "skeleton",
            terminalAccess: "disabled"
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSystemStatus()).resolves.toMatchObject({ systemName: "Frank Hub" });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/system/status", expect.objectContaining({ method: "GET" }));
  });

  it("falls back to HTTP status when the error body is not JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/v1/ops/status")).rejects.toThrow("Frank API returned HTTP 502");
  });

  it("wraps Hermes task, log, artifact, backup, and kill switch routes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          task: { id: "task-1" },
          session: { id: "session-1" },
          logs: [],
          events: [],
          last_sequence: 0,
          next_cursor: 0,
          backup: { id: "backup-1" },
          scope: "hermes",
          affectedSessions: [],
          outcome: "success"
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await runTaskWithHermes("task-1");
    await stopTaskHermes("task-1", "operator stop");
    await listTaskLogs("task-1", { afterSequence: 10, limit: 25 });
    await runBackupPreflight();
    await createFilesBackup();
    await runHermesKillSwitch("stop all active Hermes runs");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/tasks/task-1/run-hermes",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/tasks/task-1/stop-hermes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "operator stop" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/tasks/task-1/logs?after_sequence=10&limit=25",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/backups/preflight",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/backups/files",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/runners/hermes/kill-switch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "stop all active Hermes runs" })
      })
    );
    expect(getArtifactDownloadUrl("/v1/artifacts/artifact-1")).toBe("/api/v1/artifacts/artifact-1");
  });
});
