/**
 * Postgres StateStore — CH-02 (FRANK-§8E, decision M4).
 *
 * Implements the channel runtime's `StateStore` interface from
 * `@copilotkit/channels` (pinned exactly to 0.7.3) against real PostgreSQL:
 * key-value with TTL and atomic consume, capped lists with whole-list expiry,
 * auto-expiring locks, deduplication windows, and bounded FIFO queues with
 * overflow policy.
 *
 * Why Postgres and not an in-memory store: M4 makes the Postgres StateStore a
 * hard gate because a registered action or waiting decision must survive a
 * listener restart. An in-memory store agrees with itself; Postgres is the
 * thing that actually persists.
 *
 * Layout (schema `frank_channels` by default):
 *
 *   kv(kind, key)        — 'kv' values, 'lock' holders, 'dedup' windows.
 *                          One table, disjoint kinds, so keyspaces never
 *                          collide across semantics.
 *   list_item(kind,key,seq) — ordered elements for 'list' and 'queue' keys.
 *
 * All values round-trip through JSON.stringify/JSON.parse, matching the
 * SDK's JSON-serialization contract for remote backends.
 *
 * Clocks: every expiry is computed by PostgreSQL (`now() + make_interval`)
 * and compared against PostgreSQL's `now()`. Client clocks never participate,
 * so a skewed app host cannot stretch or shorten a TTL.
 *
 * Concurrency posture: single-statement atomics where one statement suffices
 * (kv consume, lock acquire/release, dedup mark); a per-key transaction with
 * a transaction-scoped advisory lock where an operation is read-modify-write
 * (list append/trim, queue enqueue/dequeue). Transaction-scoped advisory
 * locks cannot deadlock a key after a crash — the same posture as the lock
 * TTL itself.
 */

import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import type { StateStore } from '@copilotkit/channels';

/** Same default as the SDK's MemoryStore: a crashed holder can't deadlock. */
const DEFAULT_LOCK_TTL_MS = 30_000;

const SCHEMA_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export interface PostgresStateStoreConfig {
  /** Postgres connection string for the store's database. */
  connectionString: string;
  /**
   * Schema that holds the store's tables. Created if missing. Must be a
   * plain SQL identifier; anything else is rejected (it is interpolated
   * into DDL).
   */
  schema?: string;
  /** Lock TTL applied when `acquire` gets none. Defaults to 30_000 ms. */
  defaultLockTtlMs?: number;
  applicationName?: string;
  poolMax?: number;
}

/** SQL `true` for a row whose expiry has not passed (server clock). */
const LIVE = `(expires_at IS NULL OR expires_at > now())`;

/** Server-side expiry for parameter `$n` carrying a ttl in ms (or NULL). */
const ttlExpr = (n: number): string =>
  `CASE WHEN $${n}::int IS NULL THEN NULL
        ELSE now() + make_interval(secs => $${n}::int / 1000.0) END`;

export class PostgresStateStore implements StateStore {
  readonly pool: Pool;
  readonly schema: string;
  private readonly defaultLockTtlMs: number;

  constructor(config: PostgresStateStoreConfig) {
    const schema = config.schema ?? 'frank_channels';
    if (!SCHEMA_NAME.test(schema)) {
      throw new Error(
        `PostgresStateStore: schema name ${JSON.stringify(schema)} is not a plain SQL identifier`,
      );
    }
    this.schema = schema;
    this.defaultLockTtlMs = config.defaultLockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    this.pool = new Pool({
      connectionString: config.connectionString,
      application_name: config.applicationName ?? 'frank-channels-state-store',
      max: config.poolMax ?? 4,
    });
  }

  /** Idempotently create the schema and tables. */
  async migrate(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.kv (
        kind       text        NOT NULL,
        key        text        NOT NULL,
        value      jsonb,
        expires_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, key)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.list_item (
        kind       text        NOT NULL,
        key        text        NOT NULL,
        seq        bigserial   NOT NULL,
        value      jsonb       NOT NULL,
        expires_at timestamptz,
        PRIMARY KEY (kind, key, seq)
      )
    `);
    // Server-side helpers: each multi-step read-modify-write runs as ONE
    // statement (one round trip) inside a single transaction holding the
    // per-key advisory lock. Round-trip-heavy client-side locking makes
    // short-TTL semantics impossible over a slow link; moving the logic
    // server-side makes every timing window a server-clock concern only.
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION ${this.schema}.wb_list_append(
        p_key text, p_value jsonb, p_max_len int, p_ttl_ms int
      ) RETURNS int LANGUAGE plpgsql AS $$
      DECLARE
        v_len int;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('list:' || p_key));
        INSERT INTO ${this.schema}.list_item (kind, key, value, expires_at)
        VALUES ('list', p_key, p_value,
                CASE WHEN p_ttl_ms IS NULL THEN NULL
                     ELSE now() + make_interval(secs => p_ttl_ms / 1000.0) END);
        IF p_ttl_ms IS NOT NULL THEN
          UPDATE ${this.schema}.list_item
             SET expires_at = now() + make_interval(secs => p_ttl_ms / 1000.0)
           WHERE kind = 'list' AND key = p_key;
        END IF;
        IF p_max_len IS NOT NULL THEN
          DELETE FROM ${this.schema}.list_item
           WHERE kind = 'list' AND key = p_key
             AND seq NOT IN (
               SELECT seq FROM ${this.schema}.list_item
                WHERE kind = 'list' AND key = p_key
                ORDER BY seq DESC
                LIMIT p_max_len
             );
        END IF;
        SELECT count(*) INTO v_len FROM ${this.schema}.list_item
         WHERE kind = 'list' AND key = p_key
           AND (expires_at IS NULL OR expires_at > now());
        RETURN v_len;
      END $$;
    `);
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION ${this.schema}.wb_list_trim(p_key text, p_max_len int)
      RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('list:' || p_key));
        DELETE FROM ${this.schema}.list_item
         WHERE kind = 'list' AND key = p_key
           AND seq NOT IN (
             SELECT seq FROM ${this.schema}.list_item
              WHERE kind = 'list' AND key = p_key
              ORDER BY seq DESC
              LIMIT p_max_len
           );
      END $$;
    `);
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION ${this.schema}.wb_queue_enqueue(
        p_key text, p_value jsonb, p_max_size int, p_on_full text
      ) RETURNS int LANGUAGE plpgsql AS $$
      DECLARE
        n int;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('queue:' || p_key));
        SELECT count(*) INTO n FROM ${this.schema}.list_item
         WHERE kind = 'queue' AND key = p_key
           AND (expires_at IS NULL OR expires_at > now());
        IF p_max_size IS NOT NULL AND n >= p_max_size THEN
          IF COALESCE(p_on_full, 'drop-oldest') = 'drop-oldest' THEN
            DELETE FROM ${this.schema}.list_item
             WHERE kind = 'queue' AND key = p_key
               AND seq IN (
                 SELECT seq FROM ${this.schema}.list_item
                  WHERE kind = 'queue' AND key = p_key
                    AND (expires_at IS NULL OR expires_at > now())
                  ORDER BY seq ASC
                  LIMIT n - p_max_size + 1
               );
          ELSE
            RETURN n;
          END IF;
        END IF;
        INSERT INTO ${this.schema}.list_item (kind, key, value)
        VALUES ('queue', p_key, p_value);
        IF p_max_size IS NOT NULL AND n >= p_max_size THEN
          RETURN p_max_size;
        END IF;
        RETURN n + 1;
      END $$;
    `);
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION ${this.schema}.wb_queue_dequeue(p_key text)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE
        v jsonb;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('queue:' || p_key));
        DELETE FROM ${this.schema}.list_item
         WHERE kind = 'queue' AND key = p_key
           AND seq = (
             SELECT seq FROM ${this.schema}.list_item
              WHERE kind = 'queue' AND key = p_key
                AND (expires_at IS NULL OR expires_at > now())
              ORDER BY seq ASC
              LIMIT 1
           )
         RETURNING value INTO v;
        RETURN v;
      END $$;
    `);
  }

  /** Remove every stored entry. Test harness affordance. */
  async truncateAll(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE ${this.schema}.kv, ${this.schema}.list_item`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * NOTE: per-key serialization for multi-step ops lives SERVER-SIDE in the
   * `wb_list_*` / `wb_queue_*` helper functions (see `migrate()`). Each op
   * is one statement = one round trip, so short TTLs hold even over a slow
   * client-server link. kv, lock, and dedup ops are single statements
   * already and need no wrapper.
   */

  /* ------------------------------------------------------------------ */
  /* kv                                                                 */
  /* ------------------------------------------------------------------ */

  kv: StateStore['kv'] = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const result = await this.pool.query(
        `SELECT value FROM ${this.schema}.kv
          WHERE kind = 'kv' AND key = $1 AND ${LIVE}`,
        [key],
      );
      const row = result.rows[0] as { value: unknown } | undefined;
      return row === undefined ? undefined : (row.value as T);
    },

    set: async <T>(key: string, value: T, ttlMs?: number): Promise<void> => {
      await this.pool.query(
        `INSERT INTO ${this.schema}.kv (kind, key, value, expires_at, updated_at)
         VALUES ('kv', $1, $2::jsonb, ${ttlExpr(3)}, now())
         ON CONFLICT (kind, key) DO UPDATE
           SET value = EXCLUDED.value,
               expires_at = EXCLUDED.expires_at,
               updated_at = now()`,
        [key, JSON.stringify(value), ttlMs ?? null],
      );
    },

    delete: async (key: string): Promise<void> => {
      await this.pool.query(
        `DELETE FROM ${this.schema}.kv WHERE kind = 'kv' AND key = $1`,
        [key],
      );
    },

    consume: async <T>(key: string): Promise<T | undefined> => {
      // A single DELETE ... RETURNING is atomic: concurrent consumers race on
      // the row and exactly one observes it.
      const result = await this.pool.query(
        `DELETE FROM ${this.schema}.kv
          WHERE kind = 'kv' AND key = $1 AND ${LIVE}
          RETURNING value`,
        [key],
      );
      const row = result.rows[0] as { value: unknown } | undefined;
      return row === undefined ? undefined : (row.value as T);
    },
  };

  /* ------------------------------------------------------------------ */
  /* list                                                               */
  /* ------------------------------------------------------------------ */

  list: StateStore['list'] = {
    append: async <T>(
      key: string,
      value: T,
      opts?: { maxLen?: number; ttlMs?: number },
    ): Promise<number> => {
      // One round trip: the server-side helper takes the per-key advisory
      // lock, inserts, (re)sets the whole-list expiry when a ttl was given
      // (a ttl-less append must not clobber an existing one), trims to
      // maxLen oldest-first, and returns the live length.
      const result = await this.pool.query(
        `SELECT ${this.schema}.wb_list_append($1, $2::jsonb, $3::int, $4::int) AS len`,
        [key, JSON.stringify(value), opts?.maxLen ?? null, opts?.ttlMs ?? null],
      );
      return (result.rows[0] as { len: number }).len;
    },

    range: async <T>(key: string, start = 0, stop?: number): Promise<T[]> => {
      const result = await this.pool.query(
        `SELECT value FROM ${this.schema}.list_item
          WHERE kind = 'list' AND key = $1 AND ${LIVE}
          ORDER BY seq`,
        [key],
      );
      const values = result.rows.map((row) => (row as { value: unknown }).value as T);
      const end = stop === undefined ? values.length : Math.min(stop + 1, values.length);
      if (start >= end) return [];
      return values.slice(start, end);
    },

    trim: async (key: string, maxLen: number): Promise<void> => {
      await this.pool.query(
        `SELECT ${this.schema}.wb_list_trim($1, $2::int)`,
        [key, maxLen],
      );
    },

    delete: async (key: string): Promise<void> => {
      await this.pool.query(
        `DELETE FROM ${this.schema}.list_item WHERE kind = 'list' AND key = $1`,
        [key],
      );
    },
  };

  /* ------------------------------------------------------------------ */
  /* lock                                                               */
  /* ------------------------------------------------------------------ */

  lock: StateStore['lock'] = {
    acquire: async (
      key: string,
      opts?: { ttlMs?: number },
    ): Promise<{ token: string } | null> => {
      const ttlMs = opts?.ttlMs ?? this.defaultLockTtlMs;
      const token = randomUUID();
      // One statement covers both paths atomically: take over a lock whose
      // expiry has passed, or insert a fresh one. Two racing acquirers
      // serialize on the row; the loser's takeover re-checks the (now live)
      // expiry and its insert hits ON CONFLICT DO NOTHING.
      const result = await this.pool.query(
        `WITH takeover AS (
           UPDATE ${this.schema}.kv
              SET value = $2::jsonb, expires_at = ${ttlExpr(3)}, updated_at = now()
            WHERE kind = 'lock' AND key = $1 AND expires_at <= now()
            RETURNING 1 AS got
         ),
         fresh AS (
           INSERT INTO ${this.schema}.kv (kind, key, value, expires_at, updated_at)
           SELECT 'lock', $1, $2::jsonb, ${ttlExpr(3)}, now()
            WHERE NOT EXISTS (SELECT 1 FROM takeover)
            ON CONFLICT (kind, key) DO NOTHING
            RETURNING 1 AS got
         )
         SELECT EXISTS (
           SELECT 1 FROM takeover UNION ALL SELECT 1 FROM fresh
         ) AS acquired`,
        [key, JSON.stringify(token), ttlMs],
      );
      return (result.rows[0] as { acquired: boolean }).acquired ? { token } : null;
    },

    release: async (key: string, token: string): Promise<void> => {
      // Only the current owner's token frees the lock; a stale token from an
      // expired-and-reacquired lock deletes nothing.
      await this.pool.query(
        `DELETE FROM ${this.schema}.kv
          WHERE kind = 'lock' AND key = $1 AND value = to_jsonb($2::text)`,
        [key, token],
      );
    },
  };

  /* ------------------------------------------------------------------ */
  /* dedup                                                              */
  /* ------------------------------------------------------------------ */

  dedup: StateStore['dedup'] = {
    seen: async (key: string, ttlMs: number): Promise<boolean> => {
      // Insert-if-absent; on conflict refresh ONLY if the window has passed.
      // Any RETURNING row — a fresh insert or an expired-window refresh —
      // marks the FIRST sighting in its window, so the answer is "not seen"
      // (false). No row means the window is still live: a duplicate (true).
      const result = await this.pool.query(
        `INSERT INTO ${this.schema}.kv (kind, key, value, expires_at, updated_at)
         VALUES ('dedup', $1, 'true'::jsonb, ${ttlExpr(2)}, now())
         ON CONFLICT (kind, key) DO UPDATE
           SET expires_at = EXCLUDED.expires_at, updated_at = now()
         WHERE ${this.schema}.kv.expires_at <= now()
         RETURNING key`,
        [key, ttlMs],
      );
      return result.rows.length === 0;
    },
  };

  /* ------------------------------------------------------------------ */
  /* queue                                                              */
  /* ------------------------------------------------------------------ */

  queue: StateStore['queue'] = {
    enqueue: async <T>(
      key: string,
      value: T,
      opts?: { maxSize?: number; onFull?: 'drop-oldest' | 'drop-newest' },
    ): Promise<number> => {
      // One round trip; overflow policy runs server-side under the key lock.
      const result = await this.pool.query(
        `SELECT ${this.schema}.wb_queue_enqueue($1, $2::jsonb, $3::int, $4::text) AS n`,
        [key, JSON.stringify(value), opts?.maxSize ?? null, opts?.onFull ?? null],
      );
      return (result.rows[0] as { n: number }).n;
    },

    dequeue: async <T>(key: string): Promise<T | undefined> => {
      // One round trip; oldest-first FIFO pop under the server-side key lock.
      const result = await this.pool.query(
        `SELECT ${this.schema}.wb_queue_dequeue($1) AS value`,
        [key],
      );
      const value = (result.rows[0] as { value: unknown }).value;
      return value === null || value === undefined ? undefined : (value as T);
    },

    depth: async (key: string): Promise<number> => {
      const result = await this.pool.query(
        `SELECT count(*)::int AS depth FROM ${this.schema}.list_item
          WHERE kind = 'queue' AND key = $1 AND ${LIVE}`,
        [key],
      );
      return (result.rows[0] as { depth: number }).depth;
    },
  };
}

/**
 * Create a migrated PostgresStateStore. The returned store implements the
 * channel runtime's StateStore contract (M4).
 */
export async function createPostgresStateStore(
  config: PostgresStateStoreConfig,
): Promise<PostgresStateStore> {
  const store = new PostgresStateStore(config);
  await store.migrate();
  return store;
}
