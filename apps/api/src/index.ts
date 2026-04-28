import { loadConfig } from "./config.js";
import { createPgPool, waitForPostgres } from "./db.js";
import { createRedisClient, waitForRedis } from "./redis.js";
import { recordAuditEvent } from "./audit.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const pool = createPgPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);
const server = buildServer({ config, pool, redis });

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await recordAuditEvent(pool, {
    actorType: "system",
    actorId: "api",
    action: "api.startup",
    targetType: "service",
    targetId: "apps/api",
    metadata: {
      environment: config.environment,
      systemName: config.systemName
    }
  });

  await server.listen({
    host: "0.0.0.0",
    port: config.port
  });
}

async function shutdown(signal: string) {
  server.log.info({ signal }, "Shutting down Frank API");
  await server.close();
  await redis.quit();
  await pool.end();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

main().catch(async (error) => {
  server.log.error(error, "Frank API failed to start");
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
