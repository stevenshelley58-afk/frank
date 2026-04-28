import { Redis } from "ioredis";

export type RedisClient = Redis;

export function createRedisClient(redisUrl: string): RedisClient {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: true
  });
}

export async function checkRedis(redis: RedisClient) {
  const start = Date.now();
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Redis check failed"
    };
  }
}

export async function waitForRedis(redis: RedisClient, attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await checkRedis(redis);
    if (result.ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
  }
  throw new Error("Redis did not become healthy in time.");
}
