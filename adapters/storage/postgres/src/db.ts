/**
 * Connection and transaction plumbing — ADR-003, ADR-004, FRANK-§11.4.
 *
 * ## The transaction type is the ADR-004 enforcement mechanism
 *
 * ADR-004: "Domain mutations and outbox entries commit in one PostgreSQL
 * transaction." Every write method in `src/repositories/` takes a
 * {@link FrankTransaction}, never a {@link FrankDatabase}. Drizzle's transaction
 * handle is a different type from its database handle, so
 *
 *     await outbox.enqueue(db, envelope)   // does not compile
 *
 * The rule is checked by `tsc`, not by review. That matters more than it looks:
 * an outbox write that escapes its domain transaction produces an event for a
 * change that never committed, which is the exact failure ADR-004 exists to
 * prevent and the hardest one to notice in production.
 *
 * ## Pool configuration
 *
 * `numeric` is left as a string by `pg`'s default type parsers and this module
 * never registers a replacement. See `src/money.ts` for why (FIN-002).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import * as schema from './schema/index.js';

export type FrankSchema = typeof schema;

/** A pooled database handle. Cannot be passed to a repository write method. */
export type FrankDatabase = NodePgDatabase<FrankSchema>;

/** A handle inside an open transaction. The only thing a write accepts. */
export type FrankTransaction = Parameters<Parameters<FrankDatabase['transaction']>[0]>[0];

/** Either handle. Read-only repository methods accept this. */
export type FrankExecutor = FrankDatabase | FrankTransaction;

export interface CreateDatabaseOptions {
  /** libpq connection string. Never a superuser credential (FRANK-§11.4). */
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
  /** Milliseconds a statement may run before PostgreSQL cancels it. */
  readonly statementTimeoutMs?: number;
}

export interface FrankDatabaseHandle {
  readonly db: FrankDatabase;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Open a pool against the canonical domain database.
 *
 * `search_path` is pinned to `frank_domain` so an unqualified identifier in a
 * hand-written query cannot silently resolve against another schema's table —
 * FRANK-§11.4's separation is only real if it is also the default.
 */
export function createDatabase(options: CreateDatabaseOptions): FrankDatabaseHandle {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'frank-domain',
    options: `-c search_path=frank_domain,public -c statement_timeout=${
      options.statementTimeoutMs ?? 30_000
    }`,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/** Absolute path to the committed migration folder. */
export function migrationsFolder(): string {
  return new URL('../migrations', import.meta.url).pathname;
}

/**
 * Apply committed migrations.
 *
 * FRANK-§11.4: "Migration identities are separate, short-lived, and only
 * available to the release workflow." This function exists so the release
 * workflow and the integration test harness can call it with such an identity;
 * nothing in the application calls it at startup, because a service that can
 * migrate its own schema is a service holding a migration credential at runtime.
 */
export async function applyMigrations(db: FrankDatabase): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

/**
 * Run `fn` inside one transaction.
 *
 * Thin, but it is the only place a transaction is opened, so the "one
 * transaction per command" rule has a single enforcement point rather than being
 * a habit spread across call sites.
 *
 * `isolationLevel` defaults to `read committed`. The invariants in this package
 * that need more than that take explicit row locks (`audit_chain_head`,
 * `work_item`) rather than raising the isolation level globally, because a
 * serializable transaction that fails with a serialization error puts retry
 * logic into every caller.
 */
export async function withTransaction<T>(
  db: FrankDatabase,
  fn: (tx: FrankTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}

export { schema };
