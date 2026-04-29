import { createHermesRunnerAdapter, type HermesHealthResult } from "@frank/hermes-runner";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config.js";

export function registerRunnerRoutes(server: FastifyInstance, config: ApiConfig) {
  server.get("/v1/runners", async () => {
    const hermes = await hermesStatus(config);
    return {
      runners: [
        {
          id: "hermes",
          type: "hermes",
          displayName: "Hermes Operator",
          status: runnerStatusFromHealth(hermes),
          configSummary: configSummary(config, hermes),
          health: hermes
        }
      ]
    };
  });

  server.get("/v1/runners/hermes/status", async () => {
    const status = await hermesStatus(config);
    return {
      runner: {
        id: "hermes",
        type: "hermes",
        displayName: "Hermes Operator",
        status: runnerStatusFromHealth(status),
        configSummary: configSummary(config, status)
      },
      status
    };
  });

  server.post("/v1/runners/hermes/install-check", async () => {
    const status = await hermesStatus(config);
    return {
      ok: status.health === "ok",
      status,
      setupHints: setupHints(status)
    };
  });
}

async function hermesStatus(config: ApiConfig): Promise<HermesHealthResult> {
  const adapter = createHermesRunnerAdapter(config.hermes);
  return adapter.health();
}

function runnerStatusFromHealth(status: HermesHealthResult): "disabled" | "not_configured" | "available" | "unavailable" {
  if (!status.enabled) {
    return "disabled";
  }
  if (!status.configured) {
    return "not_configured";
  }
  return status.health === "ok" ? "available" : "unavailable";
}

function configSummary(config: ApiConfig, status: HermesHealthResult): Record<string, unknown> {
  return {
    enabled: status.enabled,
    configured: status.configured,
    reachable: status.reachable,
    apiBaseUrl: config.hermes.apiBaseUrl,
    apiKeyConfigured: Boolean(config.hermes.apiServerKey),
    workspaceRoot: config.hermes.workspaceRoot,
    artifactRoot: config.hermes.artifactRoot,
    timeoutSeconds: config.hermes.timeoutSeconds,
    stallTimeoutSeconds: config.hermes.stallTimeoutSeconds,
    eventsPollMs: config.hermes.eventsPollMs
  };
}

function setupHints(status: HermesHealthResult): string[] {
  if (!status.enabled) {
    return ["Set HERMES_ENABLED=true after Hermes has been configured on the private Compose network."];
  }
  if (!status.configured) {
    return ["Set HERMES_API_SERVER_KEY in .env. The key is required before Frank will use Hermes."];
  }
  if (!status.reachable) {
    return ["Start the private Hermes gateway with scripts/hermes_compose_up.sh and run scripts/hermes_check.sh."];
  }
  return ["Hermes is reachable through the private Frank API/worker path."];
}
