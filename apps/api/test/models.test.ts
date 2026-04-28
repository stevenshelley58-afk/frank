import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import type { ApiConfig } from "../src/config.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("model control plane API routes", () => {
  it("keeps model routes protected by Cloudflare Access", async () => {
    const { server } = createTestServer(new FakeModelPool(), true);

    const response = await server.inject({
      method: "GET",
      url: "/v1/providers"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "cloudflare_access_required"
    });
  });

  it("lists providers, model roles, models, and pricing-derived free models", async () => {
    const { server } = createTestServer(new FakeModelPool());

    const providers = await server.inject({
      method: "GET",
      url: "/v1/providers"
    });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().providers.map((provider: { id: string }) => provider.id)).toEqual([
      "openai",
      "openrouter"
    ]);

    const roles = await server.inject({
      method: "GET",
      url: "/v1/model-roles"
    });
    expect(roles.statusCode).toBe(200);
    expect(roles.json().modelRoles.map((role: { id: string }) => role.id)).toEqual([
      "coding_fast",
      "router_fast"
    ]);

    const models = await server.inject({
      method: "GET",
      url: "/v1/models"
    });
    expect(models.statusCode).toBe(200);
    expect(models.json().models).toHaveLength(2);

    const free = await server.inject({
      method: "GET",
      url: "/v1/models/free"
    });
    expect(free.statusCode).toBe(200);
    expect(free.json().models.map((model: { modelKey: string }) => model.modelKey)).toEqual([
      "pricing/zero-cost"
    ]);
  });

  it("returns not_configured without an outbound call when OPENROUTER_API_KEY is missing", async () => {
    const pool = new FakeModelPool();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(pool);

    const response = await server.inject({
      method: "POST",
      url: "/v1/models/refresh-openrouter"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providerId: "openrouter",
      status: "not_configured",
      refreshed: 0
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pool.audits).toEqual([
      expect.objectContaining({
        action: "models.openrouter.refresh",
        target_id: "openrouter",
        outcome: "success",
        metadata: {
          status: "not_configured"
        }
      })
    ]);
  });

  it("refreshes OpenRouter model metadata only from the models endpoint", async () => {
    const pool = new FakeModelPool();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: "catalog/free-by-price",
            name: "Catalog Free By Price",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"]
            },
            pricing: {
              prompt: "0",
              completion: "0",
              request: "0"
            },
            supported_parameters: ["tools"]
          },
          {
            id: "catalog/paid",
            name: "Catalog Paid",
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"]
            },
            pricing: {
              prompt: "0.000001",
              completion: "0"
            },
            supported_parameters: ["reasoning"]
          }
        ]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { server } = createTestServer(pool, false, "sk-test-secret");

    const response = await server.inject({
      method: "POST",
      url: "/v1/models/refresh-openrouter"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providerId: "openrouter",
      status: "success",
      refreshed: 2
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/models?output_modalities=all");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET"
    });
    expect(pool.models.get(modelKey("openrouter", "catalog/free-by-price"))?.metadata).toMatchObject({
      source: "openrouter",
      pricing: {
        prompt: "0",
        completion: "0",
        request: "0"
      }
    });
    expect(pool.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "models.openrouter.refresh",
          outcome: "success",
          metadata: expect.objectContaining({
            status: "success",
            modelCount: 2
          })
        })
      ])
    );
    expect(JSON.stringify(response.json())).not.toContain("sk-test-secret");
    expect(JSON.stringify(pool.audits)).not.toContain("sk-test-secret");

    const free = await server.inject({
      method: "GET",
      url: "/v1/models/free"
    });
    expect(free.json().models.map((model: { modelKey: string }) => model.modelKey)).toContain(
      "catalog/free-by-price"
    );
    expect(free.json().models.map((model: { modelKey: string }) => model.modelKey)).not.toContain("catalog/paid");
  });
});

function createTestServer(pool: FakeModelPool, accessEnabled = false, openrouterApiKey?: string) {
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
        audience: "test-aud"
      },
      openrouterApiKey,
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

interface ProviderRecord {
  id: string;
  display_name: string;
  status: "stubbed" | "not_configured" | "healthy" | "degraded" | "unavailable";
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ProviderHealthRecord {
  provider_id: string;
  status: "not_configured" | "healthy" | "degraded" | "unavailable";
  checked_at: string;
  latency_ms: number | null;
  message: string | null;
  metadata: Record<string, unknown>;
}

interface ModelRoleRecord {
  id: string;
  description: string;
  required_capabilities: string[];
  default_budget_tier: "low" | "standard" | "high";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ModelRecord {
  id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  capabilities: string[];
  status: "unknown" | "available" | "disabled" | "deprecated";
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

class FakeModelPool {
  readonly providers = new Map<string, ProviderRecord>([
    [
      "openai",
      {
        id: "openai",
        display_name: "OpenAI",
        status: "stubbed",
        enabled: false,
        metadata: {},
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ],
    [
      "openrouter",
      {
        id: "openrouter",
        display_name: "OpenRouter",
        status: "stubbed",
        enabled: false,
        metadata: {},
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ]
  ]);

  readonly health = new Map<string, ProviderHealthRecord>([
    [
      "openrouter",
      {
        provider_id: "openrouter",
        status: "not_configured",
        checked_at: timestamp(1),
        latency_ms: null,
        message: "Provider adapter is scaffolded only.",
        metadata: {}
      }
    ]
  ]);

  readonly roles = new Map<string, ModelRoleRecord>([
    [
      "coding_fast",
      {
        id: "coding_fast",
        description: "Fast coding edits.",
        required_capabilities: ["code"],
        default_budget_tier: "standard",
        metadata: {},
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ],
    [
      "router_fast",
      {
        id: "router_fast",
        description: "Fast routing.",
        required_capabilities: ["chat"],
        default_budget_tier: "low",
        metadata: {},
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ]
  ]);

  readonly models = new Map<string, ModelRecord>([
    [
      modelKey("openrouter", "pricing/nonzero-cost"),
      {
        id: "00000000-0000-4000-8000-000000000101",
        provider_id: "openrouter",
        model_key: "pricing/nonzero-cost",
        display_name: "Pricing Nonzero Cost",
        capabilities: ["chat"],
        status: "available",
        metadata: {
          pricing: {
            prompt: "0",
            completion: "0.000001"
          }
        },
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ],
    [
      modelKey("openrouter", "pricing/zero-cost"),
      {
        id: "00000000-0000-4000-8000-000000000102",
        provider_id: "openrouter",
        model_key: "pricing/zero-cost",
        display_name: "Pricing Zero Cost",
        capabilities: ["chat"],
        status: "available",
        metadata: {
          pricing: {
            prompt: "0",
            completion: "0",
            request: "0"
          }
        },
        created_at: timestamp(1),
        updated_at: timestamp(1)
      }
    ]
  ]);

  readonly audits: AuditRecord[] = [];
  private clock = 2;
  private idCounter = 200;

  async connect() {
    return new FakeModelClient(this);
  }

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.handleQuery<Row>(text, values);
  }

  handleQuery<Row = Record<string, unknown>>(text: string, values: unknown[] = []): QueryResult<Row> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (["begin", "commit", "rollback"].includes(normalized)) {
      return rows([]);
    }

    if (normalized.startsWith("select") && normalized.includes("from provider_registry p")) {
      const providerRows = [...this.providers.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((provider) => {
          const health = this.health.get(provider.id);
          return {
            ...provider,
            health_status: health?.status ?? null,
            checked_at: health?.checked_at ?? null,
            latency_ms: health?.latency_ms ?? null,
            health_message: health?.message ?? null,
            health_metadata: health?.metadata ?? null
          };
        });
      return rows(providerRows as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from model_roles")) {
      return rows([...this.roles.values()].sort((left, right) => left.id.localeCompare(right.id)) as Row[]);
    }

    if (normalized.startsWith("select") && normalized.includes("from model_catalog")) {
      return rows([...this.models.values()].sort((left, right) => left.model_key.localeCompare(right.model_key)) as Row[]);
    }

    if (normalized.startsWith("insert into model_catalog")) {
      const providerId = "openrouter";
      const modelKeyValue = values[0] as string;
      const existing = this.models.get(modelKey(providerId, modelKeyValue));
      const record: ModelRecord = {
        id: existing?.id ?? this.nextUuid(),
        provider_id: providerId,
        model_key: modelKeyValue,
        display_name: values[1] as string,
        capabilities: values[2] as string[],
        status: values[3] as ModelRecord["status"],
        metadata: parseJson(values[4]),
        created_at: existing?.created_at ?? this.now(),
        updated_at: this.now()
      };
      this.models.set(modelKey(providerId, modelKeyValue), record);
      return rows([]);
    }

    if (normalized.startsWith("update provider_registry")) {
      const providerId = values[0] as string;
      const existing = this.providers.get(providerId);
      if (existing) {
        this.providers.set(providerId, {
          ...existing,
          status: "healthy",
          metadata: {
            ...existing.metadata,
            ...parseJson(values[1])
          },
          updated_at: this.now()
        });
      }
      return rows([]);
    }

    if (normalized.startsWith("insert into provider_health_checks")) {
      const providerId = values[0] as string;
      this.health.set(providerId, {
        provider_id: providerId,
        status: "healthy",
        checked_at: this.now(),
        latency_ms: values[1] as number,
        message: values[2] as string,
        metadata: parseJson(values[3])
      });
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

  private nextUuid(): string {
    const suffix = String(this.idCounter).padStart(12, "0");
    this.idCounter += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  }

  private now(): string {
    const value = timestamp(this.clock);
    this.clock += 1;
    return value;
  }
}

class FakeModelClient {
  constructor(private readonly pool: FakeModelPool) {}

  async query<Row = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.handleQuery<Row>(text, values);
  }

  release() {
    return undefined;
  }
}

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
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
