import { describe, expect, it } from "vitest";
import { createHermesRunnerAdapter, redactSecrets, type FetchLike, type HermesRunnerConfig } from "../src/index.js";

const baseConfig: HermesRunnerConfig = {
  enabled: true,
  apiBaseUrl: "http://hermes:8642",
  apiServerKey: "secret-test-key",
  timeoutSeconds: 1800,
  stallTimeoutSeconds: 300,
  eventsPollMs: 1000,
  workspaceRoot: "/opt/frank-hub/workspaces",
  artifactRoot: "/opt/frank-hub/runtime/artifacts"
};

describe("HermesRunnerAdapter", () => {
  it("sends bearer auth and maps start run responses", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined; body: unknown }> = [];
    const adapter = createHermesRunnerAdapter(baseConfig, {
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          init,
          body: init?.body ? JSON.parse(String(init.body)) : null
        });
        return jsonResponse({ run_id: "run_123", status: "started" }, 202);
      }
    });

    const result = await adapter.startRun({
      taskId: "task-1",
      runnerSessionId: "session-1",
      prompt: "Run the smoke test",
      workspacePath: "/opt/frank-hub/workspaces/tasks/task-1",
      metadata: {
        source: "test"
      }
    });

    expect(result).toEqual({
      hermesRunId: "run_123",
      conversationId: null,
      status: "running",
      message: null
    });
    expect(requests[0]).toMatchObject({
      url: "http://hermes:8642/v1/runs"
    });
    expect(new Headers(requests[0]?.init?.headers).get("Authorization")).toBe("Bearer secret-test-key");
    expect(requests[0]?.body).toMatchObject({
      input: "Run the smoke test",
      session_id: "session-1",
      metadata: {
        task_id: "task-1",
        runner_session_id: "session-1"
      }
    });
  });

  it("normalizes Hermes SSE events and redacts raw secrets", async () => {
    const adapter = createHermesRunnerAdapter(baseConfig, {
      fetchImpl: async () =>
        new Response(
          [
            'data: {"event":"tool.started","tool":"shell","preview":"API_SERVER_KEY=secret-test-key"}',
            "",
            'data: {"event":"message.delta","delta":"working"}',
            "",
            'data: {"event":"run.completed","output":"done"}',
            "",
            ""
          ].join("\n"),
          {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream"
            }
          }
        )
    });

    const events = [];
    for await (const event of adapter.streamEvents({ runnerSessionId: "session-1", hermesRunId: "run_123" })) {
      events.push(event);
    }

    expect(events.map((event) => event.eventType)).toEqual(["tool.started", "message.delta", "run.completed"]);
    expect(events[0]).toMatchObject({
      source: "hermes",
      severity: "info",
      message: "Hermes started tool shell."
    });
    expect(JSON.stringify(events)).not.toContain("secret-test-key");
    expect(events[2]).toMatchObject({
      severity: "success",
      message: "done"
    });
  });

  it("uses the stop endpoint when a Hermes run id exists", async () => {
    const requests: string[] = [];
    const adapter = createHermesRunnerAdapter(baseConfig, {
      fetchImpl: async (input) => {
        requests.push(String(input));
        return jsonResponse({ run_id: "run_123", status: "stopping" });
      }
    });

    const result = await adapter.stopRun({
      runnerSessionId: "session-1",
      hermesRunId: "run_123",
      reason: "test stop"
    });

    expect(result).toEqual({
      stopped: true,
      method: "api",
      message: "Hermes stop endpoint accepted the request."
    });
    expect(requests).toEqual(["http://hermes:8642/v1/runs/run_123/stop"]);
  });

  it("falls back to Frank-only cancellation when the run id is missing", async () => {
    const adapter = createHermesRunnerAdapter(baseConfig, {
      fetchImpl: failIfCalled
    });

    const result = await adapter.stopRun({
      runnerSessionId: "session-1",
      hermesRunId: null,
      reason: "test stop"
    });

    expect(result).toMatchObject({
      stopped: true,
      method: "frank_only"
    });
  });

  it("redacts API keys and private keys from messages", () => {
    expect(redactSecrets("failed with API_SERVER_KEY=secret-test-key", baseConfig)).toBe(
      "failed with API_SERVER_KEY=[REDACTED]"
    );
    expect(
      redactSecrets(
        "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY----- and OPENROUTER_API_KEY=sk-live",
        baseConfig
      )
    ).not.toContain("sk-live");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

const failIfCalled: FetchLike = async () => {
  throw new Error("fetch should not have been called");
};
