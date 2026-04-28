import cors from "@fastify/cors";
import { providerAdapters } from "@frank/model-sdk";
import { MODEL_ROLES, type SystemStatus } from "@frank/shared";
import { noTerminalOpsConsoleSkeleton } from "@frank/tool-sdk";
import Fastify from "fastify";
import type { ApiConfig } from "./config.js";
import { recordAuditEvent } from "./audit.js";
import { checkPostgres, type PgPool } from "./db.js";
import { checkRedis, type RedisClient } from "./redis.js";
import { requireCloudflareAccess } from "./access.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAuditLogRoutes } from "./routes/audit-log.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOpsRoutes, type OpsCollectors } from "./routes/ops.js";
import { registerTaskRoutes } from "./routes/tasks.js";

export interface ServerDependencies {
  config: ApiConfig;
  pool: PgPool;
  redis: RedisClient;
  opsCollectors?: OpsCollectors;
}

export function buildServer({ config, pool, redis, opsCollectors }: ServerDependencies) {
  const server = Fastify({
    logger: {
      level: config.logLevel
    }
  });

  void server.register(cors, {
    origin: config.corsOrigins,
    credentials: true
  });

  server.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/v1/")) {
      await requireCloudflareAccess(request, reply, config);
    }
  });

  server.get("/healthz", async (_request, reply) => {
    const [postgres, redisStatus] = await Promise.all([checkPostgres(pool), checkRedis(redis)]);
    const ok = postgres.ok && redisStatus.ok;
    return reply.code(ok ? 200 : 503).send({
      status: ok ? "ok" : "degraded",
      systemName: config.systemName,
      generatedAt: new Date().toISOString(),
      checks: {
        postgres,
        redis: redisStatus
      }
    });
  });

  server.get("/v1/system/status", async () => {
    const [postgres, redisStatus, roleCount, providerCount] = await Promise.all([
      checkPostgres(pool),
      checkRedis(redis),
      countRows(pool, "model_roles"),
      countRows(pool, "provider_registry")
    ]);

    const status: SystemStatus = {
      systemName: config.systemName,
      environment: config.environment,
      dashboardUrl: config.dashboardUrl,
      apiUrl: config.apiUrl,
      generatedAt: new Date().toISOString(),
      services: {
        postgres,
        redis: redisStatus,
        cloudflareAccess: {
          ok:
            !config.cloudflareAccess.enabled ||
            Boolean(config.cloudflareAccess.issuer && config.cloudflareAccess.audiences.length > 0),
          message: config.cloudflareAccess.enabled ? "enabled" : "disabled"
        }
      },
      modelControlPlane: {
        roleCount,
        providerCount,
        routingMode: "role_based_skeleton"
      },
      opsConsole: {
        mode: "skeleton",
        terminalAccess: "disabled"
      }
    };

    return status;
  });

  server.get("/v1/model-control-plane", async () => ({
    roles: MODEL_ROLES,
    providers: providerAdapters.map((adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      status: "not_configured"
    })),
    fallbackChain: {
      status: "skeleton",
      description: "Routing will consider role pins, provider health, budgets, and fallback order."
    }
  }));

  server.get("/v1/ops-console", async () => ({
    mode: "skeleton",
    terminalAccess: "disabled",
    actions: noTerminalOpsConsoleSkeleton
  }));

  server.post("/v1/audit/test-event", async (request) => {
    await recordAuditEvent(pool, {
      actorType: "system",
      actorId: request.accessIdentity?.email ?? request.accessIdentity?.sub ?? "unknown",
      action: "audit.test_event",
      targetType: "api",
      outcome: "success",
      metadata: {
        route: "/v1/audit/test-event"
      }
    });

    return { ok: true };
  });

  registerTaskRoutes(server, pool);
  registerAgentRoutes(server, pool);
  registerModelRoutes(server, pool, config);
  registerAuditLogRoutes(server, pool);
  registerOpsRoutes(server, pool, opsCollectors);

  return server;
}

async function countRows(pool: PgPool, tableName: "model_roles" | "provider_registry"): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*) from ${tableName}`);
  return Number(result.rows[0]?.count ?? 0);
}
