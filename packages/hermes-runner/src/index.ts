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

    async startRun(input: StartRunInput): Promise<StartRunOutput> {
      const configError = getConfigError(config);
      if (configError) {
        return {
          hermesRunId: null,
          conversationId: null,
          status: "blocked",
          message: configError
        };
      }

      try {
        const response = await fetchJson(fetchImpl, config, "/v1/runs", {
          method: "POST",
          body: {
            input: input.prompt,
            session_id: input.runnerSessionId,
            metadata: {
              ...input.metadata,
              task_id: input.taskId,
              runner_session_id: input.runnerSessionId,
              workspace_path: input.workspacePath
            }
          }
        });

        if (!response.ok) {
          return {
            hermesRunId: null,
            conversationId: null,
            status: "failed",
            message: responseMessage(response, config)
          };
        }

        const body = asRecord(response.body);
        const hermesRunId = stringField(body, "run_id") ?? stringField(body, "id");
        if (!hermesRunId) {
          return {
            hermesRunId: null,
            conversationId: null,
            status: "failed",
            message: "Hermes did not return a run_id."
          };
        }

        return {
          hermesRunId,
          conversationId: stringField(body, "conversation_id") ?? stringField(body, "session_id"),
          status: "running",
          message: null
        };
      } catch (error) {
        return {
          hermesRunId: null,
          conversationId: null,
          status: "failed",
          message: error instanceof Error ? redactSecrets(error.message, config) : "Hermes start failed."
        };
      }
    },

    async *streamEvents(input: StreamEventsInput): AsyncIterable<RunnerEvent> {
      const configError = getConfigError(config);
      if (configError) {
        yield systemEvent("hermes.config_error", "error", configError);
        return;
      }

      try {
        const response = await fetchImpl(
          `${config.apiBaseUrl.replace(/\/$/, "")}/v1/runs/${encodeURIComponent(input.hermesRunId)}/events`,
          {
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${config.apiServerKey ?? ""}`
            }
          }
        );

        if (!response.ok) {
          yield systemEvent(
            "hermes.events_unavailable",
            "error",
            `Hermes events returned HTTP ${response.status}.`
          );
          return;
        }

        if (!response.body) {
          yield systemEvent("hermes.events_unavailable", "error", "Hermes events response did not include a body.");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const read = await reader.read();
          if (read.done) {
            break;
          }
          buffer += decoder.decode(read.value, { stream: true });

          const drained = drainSseEvents(buffer);
          buffer = drained.remaining;
          for (const rawEvent of drained.events) {
            yield normalizeHermesEvent(rawEvent, config);
          }
        }

        buffer += decoder.decode();
        const drained = drainSseEvents(`${buffer}\n\n`);
        for (const rawEvent of drained.events) {
          yield normalizeHermesEvent(rawEvent, config);
        }
      } catch (error) {
        yield systemEvent(
          "hermes.events_failed",
          "error",
          error instanceof Error ? redactSecrets(error.message, config) : "Hermes event stream failed."
        );
      }
    },

    async stopRun(input: StopRunInput): Promise<StopRunOutput> {
      const configError = getConfigError(config);
      if (configError) {
        return {
          stopped: false,
          method: "unavailable",
          message: configError
        };
      }

      if (!input.hermesRunId) {
        return {
          stopped: true,
          method: "frank_only",
          message: "No Hermes run id was recorded; Frank marked the session stopped locally."
        };
      }

      try {
        const response = await fetchJson(
          fetchImpl,
          config,
          `/v1/runs/${encodeURIComponent(input.hermesRunId)}/stop`,
          {
            method: "POST",
            body: {
              reason: input.reason,
              runner_session_id: input.runnerSessionId
            }
          }
        );

        if (response.ok) {
          return {
            stopped: true,
            method: "api",
            message: "Hermes stop endpoint accepted the request."
          };
        }

        if (response.status === 404) {
          return {
            stopped: true,
            method: "frank_only",
            message: "Hermes run was not found; Frank marked the session stopped locally."
          };
        }

        return {
          stopped: false,
          method: "unavailable",
          message: responseMessage(response, config)
        };
      } catch (error) {
        return {
          stopped: false,
          method: "unavailable",
          message: error instanceof Error ? redactSecrets(error.message, config) : "Hermes stop failed."
        };
      }
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
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<FetchJsonResult> {
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${config.apiServerKey ?? ""}`
  });
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers
  };
  if (body !== undefined) {
    init.body = body;
  }

  const response = await fetchImpl(`${config.apiBaseUrl.replace(/\/$/, "")}${path}`, init);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: parseJson(text)
  };
}

function getConfigError(config: HermesRunnerConfig): string | null {
  if (!config.enabled) {
    return "Hermes is disabled.";
  }
  if (!config.apiServerKey?.trim()) {
    return "Hermes is enabled but HERMES_API_SERVER_KEY is missing.";
  }
  return null;
}

function responseMessage(response: FetchJsonResult, config: HermesRunnerConfig): string {
  const record = asRecord(response.body);
  const error = asRecord(record?.error);
  const message =
    (typeof error?.message === "string" && error.message) ||
    (typeof record?.message === "string" && record.message) ||
    (typeof record?.error === "string" && record.error) ||
    `Hermes returned HTTP ${response.status}.`;
  return redactSecrets(message, config);
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

function stringField(record: Record<string, unknown> | null, field: string): string | null {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value : null;
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

function drainSseEvents(buffer: string): { events: Array<Record<string, unknown>>; remaining: string } {
  const events: Array<Record<string, unknown>> = [];
  let remaining = buffer;

  while (true) {
    const normalized = remaining.replace(/\r\n/g, "\n");
    const boundary = normalized.indexOf("\n\n");
    if (boundary === -1) {
      break;
    }

    const block = normalized.slice(0, boundary);
    remaining = normalized.slice(boundary + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!data || data === "[DONE]") {
      continue;
    }

    const parsed = parseJson(data);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      events.push(parsed as Record<string, unknown>);
    } else {
      events.push({
        event: "message.delta",
        delta: String(parsed ?? "")
      });
    }
  }

  return { events, remaining };
}

function normalizeHermesEvent(event: Record<string, unknown>, config: HermesRunnerConfig): RunnerEvent {
  const eventType = stringField(event, "event") ?? stringField(event, "type") ?? "hermes.event";
  const message = messageFromHermesEvent(eventType, event);
  const severity = severityFromHermesEvent(eventType, event);
  return {
    source: "hermes",
    eventType,
    severity,
    message: redactSecrets(message, config),
    rawEvent: capRawEvent(event, config)
  };
}

function messageFromHermesEvent(eventType: string, event: Record<string, unknown>): string {
  const explicit = stringField(event, "message");
  if (explicit) {
    return explicit;
  }

  if (eventType === "message.delta") {
    return stringField(event, "delta") ?? "Hermes produced output.";
  }
  if (eventType === "run.completed") {
    return stringField(event, "output") ?? "Hermes run completed.";
  }
  if (eventType === "run.failed") {
    return stringField(event, "error") ?? "Hermes run failed.";
  }
  if (eventType === "tool.started") {
    return `Hermes started tool ${stringField(event, "tool") ?? "unknown"}.`;
  }
  if (eventType === "tool.completed") {
    return `Hermes completed tool ${stringField(event, "tool") ?? "unknown"}.`;
  }
  if (eventType === "reasoning.available") {
    return stringField(event, "text") ?? "Hermes reasoning became available.";
  }
  return eventType;
}

function severityFromHermesEvent(
  eventType: string,
  event: Record<string, unknown>
): RunnerEvent["severity"] {
  if (eventType.includes("failed") || event.error === true || typeof event.error === "string") {
    return "error";
  }
  if (eventType.includes("completed")) {
    return "success";
  }
  return "info";
}

function systemEvent(eventType: string, severity: RunnerEvent["severity"], message: string): RunnerEvent {
  return {
    source: "system",
    eventType,
    severity,
    message,
    rawEvent: null
  };
}

function capRawEvent(event: Record<string, unknown>, config: HermesRunnerConfig): Record<string, unknown> {
  const json = redactSecrets(JSON.stringify(event), config);
  const capped = json.length > 16_000 ? `${json.slice(0, 16_000)}...` : json;
  const parsed = parseJson(capped);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {
    redacted: true,
    truncated: json.length > 16_000
  };
}
