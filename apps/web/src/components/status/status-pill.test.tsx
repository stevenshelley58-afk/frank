import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusPill } from "./status-pill.js";
import { fetchSystemStatus, getOpsStatus, type OpsStatus } from "../../api.js";
import type { SystemStatus } from "@frank/shared";

vi.mock("../../api.js", () => ({
  fetchSystemStatus: vi.fn(),
  getOpsStatus: vi.fn()
}));

const healthySystem = {
  systemName: "Frank Hub",
  environment: "development",
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
} satisfies SystemStatus;

const healthyOps = {
  status: "ok",
  generatedAt: "2026-04-30T00:00:00.000Z",
  services: {
    docker: { available: true, data: { containers: [] } },
    cloudflared: { available: true, data: { status: "active" } }
  },
  system: {
    host: { platform: "linux", release: "1", arch: "x64", uptimeSeconds: 10 },
    memory: { totalBytes: 1, freeBytes: 1, usedBytes: 0, processRssBytes: 1 },
    disk: { available: true, data: { path: "/", totalBytes: 1, freeBytes: 1, usedBytes: 0 } }
  },
  deploy: {
    git: { available: true, data: { branch: "main", commit: "abc", appVersion: null } },
    lastDeploy: { available: true, data: { deployedAt: null, source: "runtime", appVersion: null } }
  },
  mode: "read_only"
} satisfies OpsStatus;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StatusPill", () => {
  it("renders a quiet healthy status and navigates to ops when clicked", async () => {
    vi.mocked(fetchSystemStatus).mockResolvedValue(healthySystem);
    vi.mocked(getOpsStatus).mockResolvedValue(healthyOps);
    const onNavigateOps = vi.fn();
    const user = userEvent.setup();

    render(<StatusPill onNavigateOps={onNavigateOps} />);

    expect(await screen.findByRole("button", { name: "Open Ops Console: All systems operational" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open Ops Console: All systems operational" }));

    expect(onNavigateOps).toHaveBeenCalledTimes(1);
  });

  it("renders degraded state with issue count", async () => {
    vi.mocked(fetchSystemStatus).mockResolvedValue({
      ...healthySystem,
      services: {
        ...healthySystem.services,
        redis: { ok: false, message: "Redis unavailable" }
      }
    });
    vi.mocked(getOpsStatus).mockResolvedValue({ ...healthyOps, status: "partial" });

    render(<StatusPill onNavigateOps={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("2 issues")).toBeTruthy());
  });
});
