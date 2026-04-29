import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHermesExecutionHandler, loadHermesWorkerConfig } from "../src/hermes-executor.js";
import type { QueryResult, WorkerClient, WorkerPool } from "../src/task-worker.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Hermes task execution handler", () => {
  it("runs a task through fake Hermes and persists runner/task events plus final output", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/runs")) {
        return jsonResponse({ run_id: "run_fake_1", status: "started" }, 202);
      }
      if (url.endsWith("/v1/runs/run_fake_1/events")) {
        return new Response(
          [
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
        );
      }
      return jsonResponse({ error: "not_found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const artifactRoot = await mkdtemp(path.join(tmpdir(), "frank-hermes-artifacts-"));

    const pool = new FakeHermesWorkerPool();
    pool.tasks.set("task-1", {
      id: "task-1",
      title: "Fake Hermes task",
      description: "Complete the fake run.",
      metadata: {
        source: "test"
      }
    });

    const handler = createHermesExecutionHandler(
      pool,
      loadHermesWorkerConfig({
        HERMES_ENABLED: "true",
        HERMES_API_BASE_URL: "http://hermes:8642",
        HERMES_API_SERVER_KEY: "secret-test-key",
        HERMES_WORKSPACE_ROOT: "/opt/frank-hub/workspaces",
        HERMES_ARTIFACT_ROOT: artifactRoot
      })
    );

    await handler({
      taskId: "task-1",
      agentId: "ops",
      sessionId: "agent-session-1",
      workerId: "worker-1",
      attempt: 1,
      executionKind: "hermes_operator"
    });

    expect(pool.runnerSessions[0]).toMatchObject({
      task_id: "task-1",
      status: "completed",
      hermes_run_id: "run_fake_1",
      final_output: "done"
    });
    expect(pool.runnerEvents.map((event) => event.event_type)).toEqual([
      "runner.hermes.started",
      "message.delta",
      "run.completed"
    ]);
    expect(pool.taskEvents.map((event) => event.event_type)).toEqual([
      "hermes.runner.hermes.started",
      "hermes.message.delta",
      "hermes.run.completed"
    ]);
    expect(pool.artifacts).toEqual([
      expect.objectContaining({
        task_id: "task-1",
        runner_session_id: "runner-session-1",
        artifact_type: "final_report",
        name: "Hermes final report"
      })
    ]);
    await expect(readFile(pool.artifacts[0]!.storage_path, "utf8")).resolves.toBe("done");
    expect(JSON.stringify(pool.runnerEvents)).not.toContain("secret-test-key");
  });
});

interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
}

interface RunnerSessionRecord {
  id: string;
  task_id: string | null;
  hermes_run_id: string | null;
  status: "queued" | "starting" | "running" | "stopping" | "completed" | "failed" | "cancelled" | "blocked";
  workspace_path: string | null;
  metadata: Record<string, unknown>;
  final_output: string | null;
  error_summary: string | null;
}

interface RunnerEventRecord {
  runner_session_id: string;
  task_id: string | null;
  source: "frank" | "hermes" | "system";
  event_type: string;
  severity: "info" | "warning" | "error" | "success";
  message: string;
  raw_event: Record<string, unknown> | null;
  sequence: number;
}

interface TaskEventRecord {
  task_id: string;
  event_type: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
}

interface ArtifactRecord {
  id: string;
  task_id: string;
  runner_session_id: string;
  artifact_type: string;
  name: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  metadata: Record<string, unknown>;
}

class FakeHermesWorkerPool implements WorkerPool {
  readonly tasks = new Map<string, TaskRecord>();
  readonly runnerSessions: RunnerSessionRecord[] = [];
  readonly runnerEvents: RunnerEventRecord[] = [];
  readonly taskEvents: TaskEventRecord[] = [];
  readonly artifacts: ArtifactRecord[] = [];
  private idCounter = 1;

  async connect(): Promise<WorkerClient> {
    return new FakeHermesWorkerClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []): QueryResult<Row> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("select") && normalized.includes("from tasks")) {
      const task = this.tasks.get(values[0] as string);
      return rows((task ? [task] : []) as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from runner_sessions")) {
      const taskId = values[0] as string;
      return rows(this.runnerSessions.filter((session) => session.task_id === taskId) as Row[]);
    }

    if (normalized.startsWith("insert into runner_sessions")) {
      const session: RunnerSessionRecord = {
        id: `runner-session-${this.idCounter++}`,
        task_id: values[0] as string,
        hermes_run_id: null,
        status: "queued",
        workspace_path: values[1] as string,
        metadata: {},
        final_output: null,
        error_summary: null
      };
      this.runnerSessions.push(session);
      return rows([session] as Row[]);
    }

    if (normalized.startsWith("update runner_sessions") && normalized.includes("status = 'starting'")) {
      const session = this.requireSession(values[0] as string);
      session.status = "starting";
      session.workspace_path = values[1] as string;
      session.metadata = { ...session.metadata, ...parseJson(values[2]) };
      return rows([]);
    }

    if (normalized.startsWith("update runner_sessions") && normalized.includes("status = 'running'")) {
      const session = this.requireSession(values[0] as string);
      session.status = "running";
      session.hermes_run_id = values[1] as string;
      return rows([]);
    }

    if (normalized.startsWith("update runner_sessions") && normalized.includes("finished_at = now()")) {
      const session = this.requireSession(values[0] as string);
      session.status = values[1] as RunnerSessionRecord["status"];
      session.error_summary = values[2] as string | null;
      session.final_output = values[3] as string | null;
      return rows([]);
    }

    if (normalized.startsWith("insert into runner_events")) {
      const runnerSessionId = values[0] as string;
      this.runnerEvents.push({
        runner_session_id: runnerSessionId,
        task_id: values[1] as string | null,
        source: values[2] as RunnerEventRecord["source"],
        event_type: values[3] as string,
        severity: values[4] as RunnerEventRecord["severity"],
        message: values[5] as string,
        raw_event: parseJson(values[6]) as Record<string, unknown> | null,
        sequence: this.runnerEvents.filter((event) => event.runner_session_id === runnerSessionId).length + 1
      });
      return rows([]);
    }

    if (normalized.startsWith("insert into task_events")) {
      this.taskEvents.push({
        task_id: values[0] as string,
        event_type: values[1] as string,
        severity: values[2] as string,
        message: values[3] as string,
        metadata: parseJson(values[4])
      });
      return rows([]);
    }

    if (normalized.startsWith("insert into runner_artifacts")) {
      this.artifacts.push({
        id: values[0] as string,
        task_id: values[1] as string,
        runner_session_id: values[2] as string,
        artifact_type: "final_report",
        name: "Hermes final report",
        storage_path: values[3] as string,
        content_type: "text/markdown; charset=utf-8",
        size_bytes: values[4] as number,
        metadata: parseJson(values[5]) ?? {}
      });
      return rows([]);
    }

    if (normalized.startsWith("update runner_sessions set last_event_at")) {
      return rows([]);
    }

    throw new Error(`Unhandled fake query: ${normalized}`);
  }

  private requireSession(id: string): RunnerSessionRecord {
    const session = this.runnerSessions.find((candidate) => candidate.id === id);
    if (!session) {
      throw new Error(`Missing runner session ${id}`);
    }
    return session;
  }
}

class FakeHermesWorkerClient implements WorkerClient {
  constructor(private readonly pool: FakeHermesWorkerPool) {}

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.handleQuery<Row>(text, values);
  }

  release() {
    return undefined;
  }
}

function rows<Row>(items: Row[]): QueryResult<Row> {
  return {
    rows: items,
    rowCount: items.length
  };
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown> | null;
  }
  return (value ?? null) as Record<string, unknown> | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
