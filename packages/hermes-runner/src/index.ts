export interface HermesRunnerConfig {
  enabled: boolean;
  apiBaseUrl: string;
  apiServerKey: string | undefined;
  timeoutSeconds: number;
  stallTimeoutSeconds: number;
  eventsPollMs: number;
  workspaceRoot: string;
  artifactRoot: string;
}

export type HermesRunnerHealth = "ok" | "unavailable" | "error";

export interface HermesHealthResult {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  health: HermesRunnerHealth;
  models: string[];
  detailedHealth: Record<string, unknown> | null;
  message: string | null;
}

export interface RunnerEvent {
  source: "frank" | "hermes" | "system";
  eventType: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
  rawEvent: Record<string, unknown> | null;
}

export interface ArtifactCandidate {
  artifactType: string;
  name: string;
  content: string | Uint8Array;
  contentType: string;
  metadata?: Record<string, unknown>;
}

export interface StartRunInput {
  taskId: string;
  runnerSessionId: string;
  prompt: string;
  workspacePath: string | null;
  metadata: Record<string, unknown>;
}

export interface StartRunOutput {
  hermesRunId: string | null;
  conversationId: string | null;
  status: "running" | "failed" | "blocked";
  message: string | null;
}

export interface StreamEventsInput {
  runnerSessionId: string;
  hermesRunId: string;
}

export interface StopRunInput {
  runnerSessionId: string;
  hermesRunId: string | null;
  reason: string;
}

export interface StopRunOutput {
  stopped: boolean;
  method: "api" | "process" | "container" | "frank_only" | "unavailable";
  message: string;
}

export interface CollectFinalInput {
  runnerSessionId: string;
  hermesRunId: string | null;
}

export interface CollectFinalOutput {
  finalOutput: string | null;
  status: "completed" | "failed" | "cancelled" | "blocked";
  artifacts: ArtifactCandidate[];
  message: string | null;
}

export interface HermesRunnerAdapter {
  health(): Promise<HermesHealthResult>;
  startRun(input: StartRunInput): Promise<StartRunOutput>;
  streamEvents(input: StreamEventsInput): AsyncIterable<RunnerEvent>;
  stopRun(input: StopRunInput): Promise<StopRunOutput>;
  collectFinal(input: CollectFinalInput): Promise<CollectFinalOutput>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HermesRunnerAdapterOptions {
  fetchImpl?: FetchLike;
}

export function createHermesRunnerAdapter(
  config: HermesRunnerConfig,
  options: HermesRunnerAdapterOptions = {}
): HermesRunnerAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async health(): Promise<HermesHealthResult> {
      const configured = Boolean(config.apiServerKey?.trim());

      if (!config.enabled) {
        return {
          enabled: false,
          configured: false,
          reachable: false,
          health: "unavailable",
          models: [],
          detailedHealth: null,
          message: "Hermes is disabled."
        };
      }

      if (!configured) {
        return {
          enabled: true,
          configured: false,
          reachable: false,
          health: "error",
          models: [],
          detailedHealth: null,
          message: "Hermes is enabled but HERMES_API_SERVER_KEY is missing."
        };
      }

      try {
        const healthResponse = await fetchJson(fetchImpl, config, "/health");
        if (!healthResponse.ok) {
          return {
            enabled: true,
            configured: true,
            reachable: true,
            health: "error",
            models: [],
            detailedHealth: asRecord(healthResponse.body),
            message: `Hermes health returned HTTP ${healthResponse.status}.`
          };
        }

        const [detailedResponse, modelsResponse] = await Promise.all([
          fetchJson(fetchImpl, config, "/health/detailed"),
          fetchJson(fetchImpl, config, "/v1/models")
        ]);

        return {
          enabled: true,
          configured: true,
          reachable: true,
          health: "ok",
          models: modelsResponse.ok ? parseModels(modelsResponse.body) : [],
          detailedHealth: detailedResponse.ok ? asRecord(detailedResponse.body) : null,
          message: null
        };
      } catch (error) {
        return {
          enabled: true,
          configured: true,
          reachable: false,
          health: "unavailable",
          models: [],
          detailedHealth: null,
          message: error instanceof Error ? redactSecrets(error.message, config) : "Hermes is unavailable."
        };
      }
    },

    async startRun(): Promise<StartRunOutput> {
      return {
        hermesRunId: null,
        conversationId: null,
        status: "blocked",
        message: "Hermes run execution is not enabled until runner persistence is installed."
      };
    },

    async *streamEvents(): AsyncIterable<RunnerEvent> {
      return;
    },

    async stopRun(): Promise<StopRunOutput> {
      return {
        stopped: false,
        method: "unavailable",
        message: "Hermes stop is not enabled until runner persistence is installed."
      };
    },

    async collectFinal(): Promise<CollectFinalOutput> {
      return {
        finalOutput: null,
        status: "blocked",
        artifacts: [],
        message: "Hermes final collection is not enabled until runner persistence is installed."
      };
    }
  };
}

export function redactSecrets(value: string, config?: Pick<HermesRunnerConfig, "apiServerKey">): string {
  let redacted = value;
  const key = config?.apiServerKey?.trim();
  if (key) {
    redacted = redacted.split(key).join("[REDACTED]");
  }

  return redacted
    .replace(/API_SERVER_KEY=[^\s"'<>]+/gi, "API_SERVER_KEY=[REDACTED]")
    .replace(/OPENROUTER_API_KEY=[^\s"'<>]+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(/CLOUDFLARE_[A-Z0-9_]*=[^\s"'<>]+/gi, "CLOUDFLARE_[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

interface FetchJsonResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function fetchJson(
  fetchImpl: FetchLike,
  config: HermesRunnerConfig,
  path: string
): Promise<FetchJsonResult> {
  const response = await fetchImpl(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiServerKey ?? ""}`
    }
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJson(text)
  };
}

function parseJson(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseModels(value: unknown): string[] {
  const record = asRecord(value);
  const data = Array.isArray(record?.data) ? record.data : Array.isArray(record?.models) ? record.models : [];
  return data
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (typeof item === "object" && item !== null && "id" in item && typeof item.id === "string") {
        return item.id;
      }
      return null;
    })
    .filter((model): model is string => Boolean(model));
}
