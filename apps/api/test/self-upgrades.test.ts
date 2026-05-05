import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("self-upgrade routes", () => {
  it("creates a lab auto-deploy self-upgrade backed by a queued Hermes task", async () => {
    const pool = new FakeSelfUpgradePool();
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/self-upgrades",
      payload: {
        goal: "Add a command center summary",
        autoDeploy: true,
        limits: {
          externalSendPerHour: 10,
          apiSpendUsdPerDay: 5
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      selfUpgradeRun: {
        goal: "Add a command center summary",
        status: "queued",
        autoDeploy: true,
        workspacePath: "/opt/frank-hub"
      },
      task: {
        state: "queued",
        executionKind: "hermes_operator",
        assignedAgentId: "ops"
      }
    });
    expect(response.json().selfUpgradeRun.branch).toMatch(/^frank\/self-upgrade\/\d{8}t\d{6}z-add-a-command-center-summary$/);
    expect(pool.tasks[0]?.metadata).toMatchObject({
      selfUpgradeRunId: response.json().selfUpgradeRun.id,
      workspacePath: "/opt/frank-hub",
      autoDeploy: true,
      validationGate: [
        "pnpm typecheck",
        "pnpm test",
        "pnpm build",
        "docker compose config",
        "docker compose -f docker-compose.yml -f docker-compose.hermes.yml config",
        "git diff --check",
        "secret scan",
        "migration review",
        "healthcheck",
        "hermes check"
      ]
    });
    expect(pool.selfUpgradeRuns[0]?.task_id).toBe(pool.tasks[0]?.id);
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "self_upgrade.create",
        outcome: "success"
      })
    ]);
  });

  it("lists self-upgrade runs newest first", async () => {
    const pool = new FakeSelfUpgradePool();
    pool.selfUpgradeRuns.push(
      selfUpgradeRecord("00000000-0000-4000-8000-000000000111", "Old run", "completed", "2026-05-04T00:00:01.000Z"),
      selfUpgradeRecord("00000000-0000-4000-8000-000000000222", "New run", "queued", "2026-05-04T00:00:02.000Z")
    );
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "GET",
      url: "/v1/self-upgrades"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().selfUpgradeRuns.map((run: { goal: string }) => run.goal)).toEqual(["New run", "Old run"]);
  });

  it("cancels a queued self-upgrade run", async () => {
    const pool = new FakeSelfUpgradePool();
    pool.selfUpgradeRuns.push(
      selfUpgradeRecord("00000000-0000-4000-8000-000000000333", "Cancel me", "queued", "2026-05-04T00:00:03.000Z")
    );
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/self-upgrades/00000000-0000-4000-8000-000000000333/cancel",
      payload: {
        reason: "Operator changed direction"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      selfUpgradeRun: {
        id: "00000000-0000-4000-8000-000000000333",
        status: "cancelled",
        metadata: {
          cancelReason: "Operator changed direction"
        }
      }
    });
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "self_upgrade.cancel",
        outcome: "success"
      })
    ]);
  });

  it("creates a Hermes rollback task for a self-upgrade run", async () => {
    const pool = new FakeSelfUpgradePool();
    pool.selfUpgradeRuns.push(
      selfUpgradeRecord("00000000-0000-4000-8000-000000000444", "Roll me back", "failed", "2026-05-04T00:00:04.000Z")
    );
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/self-upgrades/00000000-0000-4000-8000-000000000444/rollback",
      payload: {
        reason: "Deploy health failed"
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      selfUpgradeRun: {
        id: "00000000-0000-4000-8000-000000000444",
        metadata: {
          rollbackRequested: true
        }
      },
      task: {
        state: "queued",
        executionKind: "hermes_operator",
        assignedAgentId: "ops"
      }
    });
    expect(pool.tasks.at(-1)?.metadata).toMatchObject({
      kind: "self_upgrade_rollback",
      selfUpgradeRunId: "00000000-0000-4000-8000-000000000444"
    });
  });
});

function createTestServer(pool: FakeSelfUpgradePool) {
  const server = buildServer({
    config: {
      environment: "test",
      systemName: "Frank Hub",
      domain: "frank.fail",
      dashboardUrl: "https://hub.frank.fail",
      apiUrl: "https://api.frank.fail",
      port: 0,
      databaseUrl: "postgres://frank:test@postgres:5432/frank",
      redisUrl: "redis://redis:6379",
      corsOrigins: [],
      cloudflareAccess: {
        enabled: false,
        issuer: "https://frank.cloudflareaccess.com",
        audiences: ["test-aud"]
      },
      openai: openAiTestConfig(),
      openrouterApiKey: undefined,
      hermes: {
        enabled: true,
        apiBaseUrl: "http://hermes:8642",
        apiServerKey: "test-key",
        timeoutSeconds: 1800,
        stallTimeoutSeconds: 300,
        eventsPollMs: 1000,
        workspaceRoot: "/opt/frank-hub/workspaces",
        artifactRoot: "/opt/frank-hub/runtime/artifacts"
      },
      backups: {
        root: "/opt/frank-backups"
      },
      operator: {
        mode: "lab",
        repoWorkspacePath: "/opt/frank-hub",
        allowedWorkspaces: ["/opt/frank-hub", "/opt/frank-hub/workspaces", "/opt/frank-projects"],
        protectedPaths: ["/", "/root", "/etc", "/boot", "/var/lib/docker", "/var/lib/postgresql", "/opt/frank-backups", "/opt/frank-hub/.env", "/opt/frank-hub/runtime/access", "/opt/frank-hub/runtime/hermes/.env", "/opt/frank-hub/runtime/hermes/platforms/whatsapp/session"],
        accessEnvPath: "/opt/frank-hub/runtime/access/frank-access.env",
        secretWriteEnabled: true,
        secretWriteAllowedKeys: ["FRANK_WHATSAPP_NUMBER"],
        limits: {
          externalSendPerHour: 25,
          apiSpendUsdPerDay: 10,
          fileDeleteMaxCount: 500,
          hostCommandTimeoutSeconds: 1800,
          databaseDestructiveRequiresLimit: true
        }
      },
      messaging: {
        whatsapp: {
          enabled: true,
          mode: "bot",
          allowedUsers: ["15550000000"],
          webhookBaseUrl: "http://hermes:8644",
          webhookRoute: "frank-whatsapp",
          webhookSecret: "webhook-secret"
        }
      },
      accessProfile: {
        emailAddress: undefined,
        mobileNumber: undefined,
        whatsappNumber: "+15550000000",
        apiKeyNames: []
      },
      logLevel: "silent"
    } satisfies ApiConfig,
    pool: pool as never,
    redis: {} as never
  });
  servers.push(server);
  return { server };
}

interface SelfUpgradeRecord {
  id: string;
  goal: string;
  status: string;
  auto_deploy: boolean;
  branch: string;
  base_commit: string | null;
  task_id: string | null;
  runner_session_id: string | null;
  workspace_path: string;
  backup_ids: string[];
  limits: Record<string, unknown>;
  validation_results: Record<string, unknown>;
  deploy_result: Record<string, unknown>;
  rollback_target: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  state: string;
  priority: number;
  created_by: string | null;
  assigned_agent_id: string | null;
  execution_kind: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

class FakeSelfUpgradePool {
  readonly selfUpgradeRuns: SelfUpgradeRecord[] = [];
  readonly tasks: TaskRecord[] = [];
  readonly taskEvents: unknown[] = [];
  readonly audits: Array<{ action: string; outcome: string }> = [];
  private idCounter = 1;

  async connect() {
    return new FakeSelfUpgradeClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }
    if (normalized.startsWith("insert into tasks")) {
      const task: TaskRecord = {
        id: this.nextUuid(),
        title: values[0] as string,
        description: values[1] as string | null,
        state: "queued",
        priority: values[2] as number,
        created_by: values[3] as string | null,
        assigned_agent_id: values[4] as string | null,
        execution_kind: values[5] as string | null,
        metadata: parseJson(values[6]),
        created_at: timestamp(this.idCounter),
        updated_at: timestamp(this.idCounter)
      };
      this.tasks.push(task);
      return rows([task] as Row[]);
    }
    if (normalized.startsWith("insert into self_upgrade_runs")) {
      const record: SelfUpgradeRecord = {
        id: values[0] as string,
        goal: values[1] as string,
        status: "queued",
        auto_deploy: values[2] as boolean,
        branch: values[3] as string,
        base_commit: values[4] as string | null,
        task_id: values[5] as string | null,
        runner_session_id: null,
        workspace_path: values[6] as string,
        backup_ids: [],
        limits: parseJson(values[7]),
        validation_results: {},
        deploy_result: {},
        rollback_target: {},
        metadata: parseJson(values[8]),
        created_by: values[9] as string | null,
        created_at: timestamp(this.idCounter),
        updated_at: timestamp(this.idCounter),
        finished_at: null
      };
      this.selfUpgradeRuns.push(record);
      return rows([record] as Row[]);
    }
    if (normalized.startsWith("select") && normalized.includes("from self_upgrade_runs")) {
      if (normalized.includes("where id = $1")) {
        return rows(this.selfUpgradeRuns.filter((run) => run.id === values[0]) as Row[]);
      }
      return rows([...this.selfUpgradeRuns].sort((left, right) => right.created_at.localeCompare(left.created_at)) as Row[]);
    }
    if (normalized.startsWith("update self_upgrade_runs") && normalized.includes("status = $2")) {
      const run = this.requireSelfUpgrade(values[0] as string);
      run.status = values[1] as string;
      run.metadata = {
        ...run.metadata,
        ...parseJson(values[2])
      };
      run.updated_at = timestamp(this.idCounter);
      run.finished_at = timestamp(this.idCounter);
      return rows([run] as Row[]);
    }
    if (normalized.startsWith("update self_upgrade_runs") && normalized.includes("metadata = metadata ||")) {
      const run = this.requireSelfUpgrade(values[0] as string);
      run.metadata = {
        ...run.metadata,
        ...parseJson(values[1])
      };
      run.updated_at = timestamp(this.idCounter);
      return rows([run] as Row[]);
    }
    if (normalized.startsWith("insert into task_events")) {
      this.taskEvents.push(values);
      return rows([]);
    }
    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        action: values[2] as string,
        outcome: values[5] as string
      });
      return rows([]);
    }
    if (normalized.startsWith("select count(*)")) {
      return rows([{ count: "0" }] as Row[]);
    }
    throw new Error(`Unhandled fake query: ${normalized}`);
  }

  private requireSelfUpgrade(id: string): SelfUpgradeRecord {
    const run = this.selfUpgradeRuns.find((candidate) => candidate.id === id);
    if (!run) {
      throw new Error(`Missing self-upgrade run ${id}`);
    }
    return run;
  }

  private nextUuid(): string {
    const suffix = String(this.idCounter).padStart(12, "0");
    this.idCounter += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

class FakeSelfUpgradeClient {
  constructor(private readonly pool: FakeSelfUpgradePool) {}

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.pool.handleQuery<Row>(text, values);
  }

  release() {
    return undefined;
  }
}

function selfUpgradeRecord(id: string, goal: string, status: string, createdAt: string): SelfUpgradeRecord {
  return {
    id,
    goal,
    status,
    auto_deploy: true,
    branch: "frank/self-upgrade/20260504t000000z-test",
    base_commit: null,
    task_id: null,
    runner_session_id: null,
    workspace_path: "/opt/frank-hub",
    backup_ids: [],
    limits: {},
    validation_results: {},
    deploy_result: {},
    rollback_target: {},
    metadata: {},
    created_by: "local-dev@frank.fail",
    created_at: createdAt,
    updated_at: createdAt,
    finished_at: null
  };
}

function rows<Row>(items: Row[]) {
  return {
    rows: items,
    rowCount: items.length
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  return typeof value === "string" ? JSON.parse(value) as Record<string, unknown> : (value ?? {}) as Record<string, unknown>;
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 4, 4, 0, 0, offset)).toISOString();
}

function openAiTestConfig() {
  return {
    apiKey: undefined,
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-test-chat"
  };
}
