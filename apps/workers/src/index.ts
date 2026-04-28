import { providerAdapters } from "@frank/model-sdk";
import { Redis } from "ioredis";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

const envSchema = z.object({
  FRANK_ENV: z.string().default("development"),
  FRANK_SYSTEM_NAME: z.string().default("Frank Hub"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url()
});

const config = envSchema.parse(process.env);
const pool = new Pool({ connectionString: config.DATABASE_URL });
const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});

async function main() {
  await waitForPostgres();
  await waitForRedis();
  await recordAuditEvent("worker.startup", {
    environment: config.FRANK_ENV,
    systemName: config.FRANK_SYSTEM_NAME
  });
  await recordAuditEvent("worker.openrouter_scanner_stub.ready", {
    providersScaffolded: providerAdapters.length,
    providerCallsEnabled: false
  });

  console.log("Frank worker started. Provider scanner is scaffolded and disabled.");
  setInterval(() => {
    console.log("Frank worker heartbeat", new Date().toISOString());
  }, 60_000);
}

async function waitForPostgres(attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("select 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 5000)));
    }
  }
  throw new Error("Postgres did not become healthy in time.");
}

async function waitForRedis(attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (redis.status === "wait" || redis.status === "end") {
        await redis.connect();
      }
      await redis.ping();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 5000)));
    }
  }
  throw new Error("Redis did not become healthy in time.");
}

async function recordAuditEvent(action: string, metadata: Record<string, unknown>) {
  await pool.query(
    `
      insert into audit_log (
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        outcome,
        metadata
      )
      values ('worker', 'apps/workers', $1, 'service', 'apps/workers', 'success', $2::jsonb)
    `,
    [action, JSON.stringify(metadata)]
  );
}

async function shutdown(signal: string) {
  console.log(`Frank worker shutting down after ${signal}`);
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").then(() => process.exit(0));
});

process.on("SIGINT", () => {
  void shutdown("SIGINT").then(() => process.exit(0));
});

main().catch(async (error) => {
  console.error(error);
  await shutdown("startup-failure");
  process.exit(1);
});
