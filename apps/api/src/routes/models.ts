import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { recordAuditEvent } from "../audit.js";
import type { ApiConfig } from "../config.js";
import type { PgPool } from "../db.js";

const openrouterModelsUrl = "https://openrouter.ai/api/v1/models?output_modalities=all";

const knownPricingFields = [
  "prompt",
  "completion",
  "request",
  "image",
  "web_search",
  "internal_reasoning",
  "input_cache_read",
  "input_cache_write"
] as const;

const modelListQuerySchema = z.object({
  providerId: z.string().trim().min(1).optional(),
  status: z.enum(["unknown", "available", "disabled", "deprecated"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const openrouterModelSchema = z
  .object({
    id: z.string().trim().min(1),
    canonical_slug: z.string().optional(),
    name: z.string().optional(),
    created: z.number().optional(),
    description: z.string().optional(),
    context_length: z.number().optional(),
    architecture: z.record(z.unknown()).optional(),
    pricing: z.record(z.unknown()).optional(),
    top_provider: z.record(z.unknown()).nullable().optional(),
    per_request_limits: z.unknown().optional(),
    supported_parameters: z.array(z.string()).optional(),
    default_parameters: z.record(z.unknown()).nullable().optional(),
    expiration_date: z.string().nullable().optional()
  })
  .passthrough();

const openrouterModelsResponseSchema = z.object({
  data: z.array(openrouterModelSchema)
});

type OpenRouterModel = z.infer<typeof openrouterModelSchema>;

interface ProviderRow {
  id: string;
  display_name: string;
  status: "stubbed" | "not_configured" | "healthy" | "degraded" | "unavailable";
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
  health_status: "not_configured" | "healthy" | "degraded" | "unavailable" | null;
  checked_at: Date | string | null;
  latency_ms: number | null;
  health_message: string | null;
  health_metadata: Record<string, unknown> | null;
}

interface ModelRoleRow {
  id: string;
  description: string;
  required_capabilities: string[];
  default_budget_tier: "low" | "standard" | "high";
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ModelCatalogRow {
  id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  capabilities: string[];
  status: "unknown" | "available" | "disabled" | "deprecated";
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

export function registerModelRoutes(server: FastifyInstance, pool: PgPool, config: ApiConfig): void {
  server.get("/v1/providers", async () => {
    const result = await pool.query<ProviderRow>(
      `
        select
          p.id,
          p.display_name,
          p.status,
          p.enabled,
          p.metadata,
          p.created_at,
          p.updated_at,
          h.status as health_status,
          h.checked_at,
          h.latency_ms,
          h.message as health_message,
          h.metadata as health_metadata
        from provider_registry p
        left join provider_health_checks h on h.provider_id = p.id
        order by p.id asc
      `
    );

    return { providers: result.rows.map(serializeProvider) };
  });

  server.get("/v1/model-roles", async () => {
    const result = await pool.query<ModelRoleRow>(
      `
        select
          id,
          description,
          required_capabilities,
          default_budget_tier,
          metadata,
          created_at,
          updated_at
        from model_roles
        order by id asc
      `
    );

    return { modelRoles: result.rows.map(serializeModelRole) };
  });

  server.get("/v1/models", async (request, reply) => {
    const query = modelListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const result = await listModels(pool, query.data);
    return { models: result.map(serializeModel) };
  });

  server.get("/v1/models/free", async (request, reply) => {
    const query = modelListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendValidationError(reply, query.error);
    }

    const models = await listModels(pool, query.data);
    return {
      models: models.filter((model) => isFreeModelMetadata(model.metadata)).map(serializeModel)
    };
  });

  server.post("/v1/models/refresh-openrouter", async (request, reply) => {
    const actorId = getRequestActorId(request);
    const apiKey = config.openrouterApiKey;

    if (!apiKey) {
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "models.openrouter.refresh",
        targetType: "provider",
        targetId: "openrouter",
        outcome: "success",
        metadata: {
          status: "not_configured"
        }
      });

      return {
        providerId: "openrouter",
        status: "not_configured",
        refreshed: 0,
        message: "OPENROUTER_API_KEY is not configured."
      };
    }

    const startedAt = Date.now();

    try {
      const response = await fetch(openrouterModelsUrl, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "user-agent": "Frank Hub OpenRouter metadata scanner"
        }
      });

      if (!response.ok) {
        throw new Error(`OpenRouter models endpoint returned HTTP ${response.status}.`);
      }

      const parsed = openrouterModelsResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("OpenRouter models response did not match the expected metadata shape.");
      }

      const refreshedAt = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const model of parsed.data.data) {
          await upsertOpenRouterModel(client, model, refreshedAt);
        }

        await client.query(
          `
            update provider_registry
            set
              status = 'healthy',
              metadata = metadata || $2::jsonb,
              updated_at = now()
            where id = $1
          `,
          [
            "openrouter",
            JSON.stringify({
              scanner: {
                status: "healthy",
                lastRefreshAt: refreshedAt,
                modelCount: parsed.data.data.length
              }
            })
          ]
        );

        await client.query(
          `
            insert into provider_health_checks (
              provider_id,
              status,
              checked_at,
              latency_ms,
              message,
              metadata
            )
            values ($1, 'healthy', now(), $2, $3, $4::jsonb)
            on conflict (provider_id) do update set
              status = excluded.status,
              checked_at = excluded.checked_at,
              latency_ms = excluded.latency_ms,
              message = excluded.message,
              metadata = excluded.metadata
          `,
          [
            "openrouter",
            Date.now() - startedAt,
            "OpenRouter model metadata refresh succeeded.",
            JSON.stringify({
              endpoint: openrouterModelsUrl,
              modelCount: parsed.data.data.length
            })
          ]
        );

        await recordAuditEvent(client, {
          actorType: "user",
          actorId,
          action: "models.openrouter.refresh",
          targetType: "provider",
          targetId: "openrouter",
          outcome: "success",
          metadata: {
            status: "success",
            modelCount: parsed.data.data.length,
            endpoint: openrouterModelsUrl
          }
        });

        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      return {
        providerId: "openrouter",
        status: "success",
        refreshed: parsed.data.data.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenRouter refresh failed.";
      await recordAuditEvent(pool, {
        actorType: "user",
        actorId,
        action: "models.openrouter.refresh",
        targetType: "provider",
        targetId: "openrouter",
        outcome: "failure",
        metadata: {
          status: "failure",
          message,
          endpoint: openrouterModelsUrl
        }
      }).catch(() => undefined);

      return reply.code(502).send({
        providerId: "openrouter",
        status: "failed",
        error: "openrouter_refresh_failed",
        message
      });
    }
  });
}

interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

async function listModels(
  db: Queryable,
  query: { providerId?: string | undefined; status?: ModelCatalogRow["status"] | undefined; limit: number }
): Promise<ModelCatalogRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (query.providerId) {
    values.push(query.providerId);
    where.push(`provider_id = $${values.length}`);
  }
  if (query.status) {
    values.push(query.status);
    where.push(`status = $${values.length}`);
  }

  values.push(query.limit);
  const result = await db.query<ModelCatalogRow>(
    `
      select
        id,
        provider_id,
        model_key,
        display_name,
        capabilities,
        status,
        metadata,
        created_at,
        updated_at
      from model_catalog
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by provider_id asc, model_key asc
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

async function upsertOpenRouterModel(db: Queryable, model: OpenRouterModel, refreshedAt: string): Promise<void> {
  const status = model.expiration_date ? "deprecated" : "available";
  const pricing = model.pricing ?? {};
  const metadata = {
    source: "openrouter",
    refreshedAt,
    canonicalSlug: model.canonical_slug ?? null,
    created: model.created ?? null,
    description: model.description ?? null,
    contextLength: model.context_length ?? null,
    architecture: model.architecture ?? {},
    pricing,
    topProvider: model.top_provider ?? null,
    perRequestLimits: model.per_request_limits ?? null,
    supportedParameters: model.supported_parameters ?? [],
    defaultParameters: model.default_parameters ?? null,
    expirationDate: model.expiration_date ?? null
  };

  await db.query(
    `
      insert into model_catalog (
        provider_id,
        model_key,
        display_name,
        capabilities,
        status,
        metadata
      )
      values ('openrouter', $1, $2, $3::text[], $4, $5::jsonb)
      on conflict (provider_id, model_key) do update set
        display_name = excluded.display_name,
        capabilities = excluded.capabilities,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = now()
    `,
    [model.id, model.name ?? model.id, deriveCapabilities(model), status, JSON.stringify(metadata)]
  );
}

function deriveCapabilities(model: OpenRouterModel): string[] {
  const capabilities = new Set<string>();
  const architecture = model.architecture ?? {};
  const outputModalities = arrayOfStrings(architecture.output_modalities);
  const inputModalities = arrayOfStrings(architecture.input_modalities);
  const supportedParameters = model.supported_parameters ?? [];

  if (outputModalities.includes("text") || outputModalities.length === 0) {
    capabilities.add("chat");
  }
  if (inputModalities.includes("image")) {
    capabilities.add("vision");
  }
  if (outputModalities.includes("image")) {
    capabilities.add("image_generation");
  }
  if (outputModalities.includes("embeddings")) {
    capabilities.add("embedding");
  }
  if (supportedParameters.includes("reasoning") || supportedParameters.includes("include_reasoning")) {
    capabilities.add("reasoning");
  }

  return [...capabilities].sort();
}

export function isFreeModelMetadata(metadata: Record<string, unknown>): boolean {
  const pricing = extractPricing(metadata);
  if (!pricing) {
    return false;
  }

  let sawPricingField = false;
  for (const field of knownPricingFields) {
    if (!Object.hasOwn(pricing, field)) {
      continue;
    }
    sawPricingField = true;
    if (Number(pricing[field]) !== 0) {
      return false;
    }
  }

  return sawPricingField;
}

function extractPricing(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(metadata.pricing)) {
    return metadata.pricing;
  }
  if (isRecord(metadata.openrouter) && isRecord(metadata.openrouter.pricing)) {
    return metadata.openrouter.pricing;
  }
  return undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeProvider(row: ProviderRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    enabled: row.enabled,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at),
    health: {
      status: row.health_status,
      checkedAt: row.checked_at ? serializeTimestamp(row.checked_at) : null,
      latencyMs: row.latency_ms,
      message: row.health_message,
      metadata: row.health_metadata ?? {}
    }
  };
}

function serializeModelRole(row: ModelRoleRow) {
  return {
    id: row.id,
    description: row.description,
    requiredCapabilities: row.required_capabilities,
    defaultBudgetTier: row.default_budget_tier,
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function serializeModel(row: ModelCatalogRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelKey: row.model_key,
    displayName: row.display_name,
    capabilities: row.capabilities,
    status: row.status,
    free: isFreeModelMetadata(row.metadata),
    metadata: row.metadata,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at)
  };
}

function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    message: "Request validation failed.",
    details: error.flatten()
  });
}

function getRequestActorId(request: FastifyRequest): string {
  return request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown";
}

function serializeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
