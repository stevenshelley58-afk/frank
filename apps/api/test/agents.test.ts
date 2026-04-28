import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";
import type { AgentPermissionLevel } from "@frank/shared";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("agent registry API routes", () => {
  it("keeps agent routes protected by Cloudflare Access", async () => {
    const { server } = createTestServer(new FakeAgentPool(), true);

    const response = await server.inject({
      method: "GET",
      url: "/v1/agents"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "cloudflare_access_required"
    });
  });

  it("lists and fetches seeded agents", async () => {
    const { server } = createTestServer(new FakeAgentPool());

    const list = await server.inject({
      method: "GET",
      url: "/v1/agents"
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().agents.map((agent: { id: string }) => agent.id)).toEqual(["coding", "frank"]);

    const get = await server.inject({
      method: "GET",
      url: "/v1/agents/frank"
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().agent).toMatchObject({
      id: "frank",
      displayName: "Frank",
      modelRoleId: "router_fast"
    });

    const missing = await server.inject({
      method: "GET",
      url: "/v1/agents/nope"
    });
    expect(missing.statusCode).toBe(404);
  });

  it("returns default permission levels from seeded policies", async () => {
    const { server } = createTestServer(new FakeAgentPool());

    const response = await server.inject({
      method: "GET",
      url: "/v1/agents/frank/permissions"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual([
      expect.objectContaining({
        permissionId: "tool.host",
        level: "denied",
        source: "default"
      }),
      expect.objectContaining({
        permissionId: "tool.read",
        level: "auto",
        source: "default"
      }),
      expect.objectContaining({
        permissionId: "tool.write",
        level: "manual",
        source: "default"
      })
    ]);
  });

  it("patches permissions transactionally and writes audit_log", async () => {
    const pool = new FakeAgentPool();
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "PATCH",
      url: "/v1/agents/frank/permissions",
      payload: {
        permissions: [
          {
            permissionId: "tool.read",
            level: "auto_review",
            metadata: {
              reason: "stage2 test"
            }
          },
          {
            permissionId: "tool.write",
            level: "manual"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          permissionId: "tool.read",
          level: "auto_review",
          source: "override",
          metadata: {
            reason: "stage2 test"
          }
        }),
        expect.objectContaining({
          permissionId: "tool.write",
          level: "manual",
          source: "override"
        })
      ])
    );
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "agent.permissions.update",
        target_type: "agent",
        target_id: "frank"
      })
    ]);
  });

  it("rejects raw host permission elevation", async () => {
    const pool = new FakeAgentPool();
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "PATCH",
      url: "/v1/agents/frank/permissions",
      payload: {
        permissions: [
          {
            permissionId: "tool.host",
            level: "auto"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "host_permission_denied"
    });
    expect(pool.permissions.size).toBe(0);
    expect(pool.audits).toHaveLength(0);
  });
});

function createTestServer(pool: FakeAgentPool, accessEnabled = false) {
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
        enabled: accessEnabled,
        issuer: "https://frank.cloudflareaccess.com",
        audiences: ["test-aud"]
      },
      openrouterApiKey: undefined,
      logLevel: "silent"
    } satisfies ApiConfig,
    pool: pool as never,
    redis: {} as never
  });
  servers.push(server);
  return { server };
}

type QueryResult<Row> = {
  rows: Row[];
  rowCount: number | null;
};

interface AgentRecord {
  id: string;
  display_name: string;
  description: string;
  status: "available" | "disabled" | "planned";
  model_role_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface PermissionPolicyRecord {
  id: string;
  description: string;
  default_decision: "allow" | "deny" | "approval_required";
  metadata: Record<string, unknown>;
}

interface AgentPermissionRecord {
  agent_id: string;
  permission_id: string;
  level: AgentPermissionLevel;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface AuditRecord {
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

class FakeAgentPool {
  readonly agents = new Map<string, AgentRecord>([
    [
      "coding",
      {
        id: "coding",
        display_name: "Coding",
        description: "Coding and code review task agent surface.",
        status: "available",
        model_role_id: "coding_heavy",
        metadata: {
          foundation: true
        },
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ],
    [
      "frank",
      {
        id: "frank",
        display_name: "Frank",
        description: "Primary Frank Hub coordinator for dashboard-first work.",
        status: "available",
        model_role_id: "router_fast",
        metadata: {
          foundation: true
        },
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ]
  ]);

  readonly policies = new Map<string, PermissionPolicyRecord>([
    [
      "tool.host",
      {
        id: "tool.host",
        description: "Unrestricted host command execution is denied.",
        default_decision: "deny",
        metadata: {
          foundation: true
        }
      }
    ],
    [
      "tool.read",
      {
        id: "tool.read",
        description: "Read-only dashboard and system inspection operations.",
        default_decision: "allow",
        metadata: {
          foundation: true
        }
      }
    ],
    [
      "tool.write",
      {
        id: "tool.write",
        description: "Write operations require explicit dashboard approval.",
        default_decision: "approval_required",
        metadata: {
          foundation: true
        }
      }
    ]
  ]);

  readonly permissions = new Map<string, AgentPermissionRecord>();
  readonly audits: AuditRecord[] = [];
  private clock = 2;

  async connect() {
    return new FakeAgentClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []): QueryResult<Row> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }

    if (normalized.startsWith("select") && normalized.includes("from agents") && normalized.includes("where id = $1")) {
      const agent = this.agents.get(values[0] as string);
      return rows((agent ? [agent] : []) as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from agents")) {
      return rows([...this.agents.values()].sort((left, right) => left.id.localeCompare(right.id)) as Row[]);
    }

    if (normalized === "select id from permission_policies where id = any($1::text[])") {
      const ids = values[0] as string[];
      return rows(ids.filter((id) => this.policies.has(id)).map((id) => ({ id })) as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from permission_policies p")) {
      const agentId = values[0] as string;
      const permissionRows = [...this.policies.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((policy) => {
          const permission = this.permissions.get(permissionKey(agentId, policy.id));
          return {
            id: policy.id,
            description: policy.description,
            default_decision: policy.default_decision,
            metadata: policy.metadata,
            level: permission?.level ?? null,
            permission_metadata: permission?.metadata ?? null,
            permission_created_at: permission?.created_at ?? null,
            permission_updated_at: permission?.updated_at ?? null
          };
        });
      return rows(permissionRows as Row[]);
    }

    if (normalized.startsWith("insert into agent_permissions")) {
      const agentId = values[0] as string;
      const permissionId = values[1] as string;
      const existing = this.permissions.get(permissionKey(agentId, permissionId));
      const record: AgentPermissionRecord = {
        agent_id: agentId,
        permission_id: permissionId,
        level: values[2] as AgentPermissionLevel,
        metadata: parseJson(values[3]),
        created_at: existing?.created_at ?? this.now(),
        updated_at: this.now()
      };
      this.permissions.set(permissionKey(agentId, permissionId), record);
      return rows([]);
    }

    if (normalized.startsWith("insert into audit_log")) {
      this.audits.push({
        actor_type: values[0] as string,
        actor_id: values[1] as string | null,
        action: values[2] as string,
        target_type: values[3] as string,
        target_id: values[4] as string | null,
        outcome: values[5] as string,
        metadata: parseJson(values[6])
      });
      return rows([]);
    }

    throw new Error(`Unhandled fake query: ${normalized}`);
  }

  private now(): string {
    const value = timestamp(this.clock);
    this.clock += 1;
    return value;
  }
}

class FakeAgentClient {
  constructor(private readonly pool: FakeAgentPool) {}

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.handleQuery<Row>(text, values);
  }

  release() {
    return undefined;
  }
}

function permissionKey(agentId: string, permissionId: string): string {
  return `${agentId}:${permissionId}`;
}

function rows<Row>(items: Row[]): QueryResult<Row> {
  return {
    rows: items,
    rowCount: items.length
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}

function timestamp(second: number): string {
  return new Date(Date.UTC(2026, 3, 28, 0, 0, second)).toISOString();
}
