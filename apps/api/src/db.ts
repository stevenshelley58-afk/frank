import pg from "pg";

const { Pool } = pg;

export type PgPool = pg.Pool;

export function createPgPool(databaseUrl: string): PgPool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}

export async function checkPostgres(pool: PgPool) {
  const start = Date.now();
  try {
    await pool.query("select 1");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message : "Postgres check failed"
    };
  }
}

export async function waitForPostgres(pool: PgPool, attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await checkPostgres(pool);
    if (result.ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
  }
  throw new Error("Postgres did not become healthy in time.");
}
