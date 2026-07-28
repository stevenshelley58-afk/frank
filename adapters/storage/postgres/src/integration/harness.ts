/**
 * Integration test harness — FRANK-§18.1 ("Integration: real database, queue,
 * object store, and connector sandboxes").
 *
 * Every file in this directory needs a real PostgreSQL. Not because it is
 * convenient to have one, but because the things they assert are *PostgreSQL's*
 * guarantees, not this package's: a `BEFORE UPDATE` trigger, a composite foreign
 * key, `ON CONFLICT DO NOTHING` under concurrency, `ROLLBACK`, and `numeric`
 * arithmetic. A fake would agree with whatever this code believes, which is the
 * one thing an integration test must not do.
 *
 * ## Skipping
 *
 * When `FRANK_TEST_DATABASE_URL` is unset, every suite here self-skips with a
 * visible reason rather than passing. {@link requiresDatabase} is the switch;
 * `vitest run` prints the skipped files, so "no database" never looks like
 * "everything is fine".
 *
 * Set it to a database the test may freely truncate:
 *
 *     FRANK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/frank_test pnpm test
 *
 * ## Cleanup and privilege
 *
 * `resetDatabase` truncates every table except `work_state_transition` (which is
 * migration-seeded reference data). It has to set `session_replication_role =
 * replica` first, because `audit_entry`, `source_version`, and
 * `work_item_transition` carry append-only triggers that refuse `DELETE` and
 * `TRUNCATE` — which is the behaviour under test. Needing an elevated setting to
 * clean up is the correct shape: FRANK-§11.4 says no service holds a superuser
 * credential at runtime, and the test harness is not a service.
 */

import { sql } from 'drizzle-orm';

import { applyMigrations, createDatabase } from '../db.js';
import type { FrankDatabase, FrankDatabaseHandle } from '../db.js';

export const DATABASE_URL = process.env['FRANK_TEST_DATABASE_URL'];

/**
 * `true` when integration tests must be skipped. Pass to `describe.skipIf`.
 */
export const requiresDatabase = DATABASE_URL === undefined || DATABASE_URL === '';

export const SKIP_REASON =
  'requires a live PostgreSQL: set FRANK_TEST_DATABASE_URL to a database this test may truncate';

let handle: FrankDatabaseHandle | undefined;
let migrated = false;

/** Open (once per worker) a migrated database handle. */
export async function openTestDatabase(): Promise<FrankDatabase> {
  if (DATABASE_URL === undefined || DATABASE_URL === '') {
    throw new Error(`openTestDatabase() called without FRANK_TEST_DATABASE_URL. ${SKIP_REASON}.`);
  }
  if (handle === undefined) {
    handle = createDatabase({ connectionString: DATABASE_URL, applicationName: 'frank-domain-test' });
  }
  if (!migrated) {
    await applyMigrations(handle.db);
    migrated = true;
  }
  return handle.db;
}

export async function closeTestDatabase(): Promise<void> {
  if (handle !== undefined) {
    await handle.close();
    handle = undefined;
    migrated = false;
  }
}

/**
 * Empty every domain table, preserving migration-seeded reference data.
 *
 * The table list is read from the catalogue rather than hard-coded, so a table
 * added to the schema without being added here cannot silently leak rows between
 * tests.
 */
export async function resetDatabase(db: FrankDatabase): Promise<void> {
  const rows = await db.execute<{ list: string | null }>(sql`
    select string_agg(format('%I.%I', schemaname, tablename), ', ') as list
    from pg_tables
    where schemaname = 'frank_domain'
      and tablename <> 'work_state_transition'
  `);

  const list = rows.rows[0]?.list;
  if (list === null || list === undefined) return;

  await db.execute(sql`set session_replication_role = 'replica'`);
  try {
    await db.execute(sql.raw(`truncate table ${list} restart identity cascade`));
  } finally {
    await db.execute(sql`set session_replication_role = 'origin'`);
  }
}

/* ------------------------------------------------------------ test fixtures */

export const CELL = 'cell-steven';

export const OWNER = { kind: 'user', id: 'steven' } as const;

export const PROVENANCE = {
  method: 'capture',
  producer: 'test/harness',
  correlationId: 'test-correlation',
} as const;

export const POLICY_REF = { ref: 'autonomous-internal-work', version: '3.2.0' } as const;

export const RIGHTS_POLICY = { ref: 'personal-capture', version: '1.0.0' } as const;

export const RETENTION_POLICY = { ref: 'source-default', version: '1.0.0' } as const;

/* -------------------------------------------------------- error assertions */

/**
 * Assert that a database operation fails with a PostgreSQL error matching
 * `pattern`.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose own message is
 * `Failed query: …` — the constraint name, the trigger's `RAISE EXCEPTION`
 * text, and the SQLSTATE all live on the `cause`. Asserting on the wrapper's
 * message would pass for *any* failure of that statement, including a typo in
 * the test's own SQL, which is the opposite of what these tests are for. This
 * walks the cause chain and matches against every message in it.
 */
export async function expectDatabaseError(
  operation: Promise<unknown> | (() => Promise<unknown>),
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  try {
    await (typeof operation === 'function' ? operation() : operation);
  } catch (error) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(`Expected the operation to fail with ${pattern}, but it succeeded.`);
  }

  const messages: string[] = [];
  let current: unknown = thrown;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    const detail = (current as { detail?: unknown }).detail;
    if (typeof detail === 'string') messages.push(detail);
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') messages.push(constraint);
    current = (current as { cause?: unknown }).cause;
  }

  if (!messages.some((message) => pattern.test(message))) {
    throw new Error(
      `Expected a database error matching ${pattern}, but got:\n  ${messages.join('\n  ')}`,
    );
  }
}
