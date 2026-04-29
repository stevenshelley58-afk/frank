import { Redis } from "ioredis";
import pg from "pg";
import { z } from "zod";
import { createHermesExecutionHandler, loadHermesWorkerConfig } from "./hermes-executor.js";
import { loadTaskWorkerConfig, startTaskWorker, type RunningTaskWorker } from "./task-worker.js";

const { Pool } = pg;

const envSchema = z.object({
  FRANK_ENV: z.string().default("development"),
  FRANK_SYSTEM_NAME: z.string().default("Frank Hub"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url()
});

const config = envSchema.parse(process.env);
const taskWorkerConfig = loadTaskWorkerConfig(process.env);
const hermesConfig = loadHermesWorkerConfig(process.env);
const pool = new Pool({ connectionString: config.DATABASE_URL });
const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2
});
let runningWorker: RunningTaskWorker | undefined;

async function main() {
  await waitForPostgres();
  await waitForRedis();
  await recordAuditEvent(taskWorkerConfig.workerId, "worker.startup", {
    environment: config.FRANK_ENV,
    systemName: config.FRANK_SYSTEM_NAME
  });
  await recordAuditEvent(taskWorkerConfig.workerId, "worker.task_core.ready", {
    workerId: taskWorkerConfig.workerId,
    pollIntervalMs: taskWorkerConfig.pollIntervalMs,
    leaseSeconds: taskWorkerConfig.leaseSeconds,
    batchSize: taskWorkerConfig.batchSize,
    executionEnabled: hermesConfig.enabled ? "manual_lifecycle_and_hermes_operator" : "manual_lifecycle_only",
    externalCallsEnabled: hermesConfig.enabled
  });

  runningWorker = startTaskWorker(pool, taskWorkerConfig, {
    logger: console,
    executionHandlers: {
      hermes_operator: createHermesExecutionHandler(pool, hermesConfig)
    }
  });
  console.log("Frank worker started. Task worker is polling queued manual and Hermes tasks.");
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

async function recordAuditEvent(actorId: string, action: string, metadata: Record<string, unknown>) {
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
      values ('worker', $1, $2, 'service', 'apps/workers', 'success', $3::jsonb)
    `,
    [actorId, action, JSON.stringify(metadata)]
  );
}

async function shutdown(signal: string) {
  console.log(`Frank worker shutting down after ${signal}`);
  await runningWorker?.stop().catch(() => undefined);
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
