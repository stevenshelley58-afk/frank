/**
 * Shared real-PostgreSQL plumbing for `apps/api` integration tests.
 *
 * Follows the discipline of `slice1.integration.test.ts`: the configured
 * `FRANK_TEST_DATABASE_URL` names the SERVER; this suite derives the sibling
 * `..._api` database so it never truncates rows that the
 * `adapters/storage/postgres` suites (which own the configured database) are
 * asserting on. `FRANK_TEST_API_DATABASE_URL` overrides the derivation.
 *
 * Every suite that uses this self-skips with a visible reason when the
 * variable is unset — "no database" must never look like "everything is
 * fine" (FRANK-§18.1).
 */

import { sql } from 'drizzle-orm';

import { applyMigrations, createDatabase } from '@frank/adapter-postgres';
import type { FrankDatabase, FrankDatabaseHandle } from '@frank/adapter-postgres';

export const CONFIGURED_URL = process.env['FRANK_TEST_DATABASE_URL'];

export const requiresDatabase = CONFIGURED_URL === undefined || CONFIGURED_URL === '';

export const SKIP_REASON =
  'requires a live PostgreSQL: set FRANK_TEST_DATABASE_URL to a database this test may truncate';

export function apiDatabaseUrl(): string | undefined {
  const override = process.env['FRANK_TEST_API_DATABASE_URL'];
  if (override !== undefined && override !== '') return override;
  if (CONFIGURED_URL === undefined || CONFIGURED_URL === '') return undefined;
  const url = new URL(CONFIGURED_URL);
  const name = url.pathname.replace(/^\//, '');
  url.pathname = `/${name.length === 0 ? 'frank_test' : name}_api`;
  return url.toString();
}

/** Create the sibling `_api` database if it does not exist. */
export async function ensureApiDatabase(): Promise<void> {
  const targetUrl = apiDatabaseUrl();
  if (targetUrl === undefined) return;
  const target = new URL(targetUrl).pathname.replace(/^\//, '');
  const admin = createDatabase({
    connectionString: CONFIGURED_URL as string,
    applicationName: 'frank-api-test-provisioner',
    max: 1,
  });
  try {
    const existing = await admin.db.execute<{ one: number }>(
      sql`select 1 as one from pg_database where datname = ${target}`,
    );
    if (existing.rows.length === 0) {
      // Identifier, not a value — PostgreSQL accepts no parameter here.
      // `target` derives from the operator's own connection string.
      await admin.db.execute(sql.raw(`create database "${target.replace(/"/g, '""')}"`));
    }
  } finally {
    await admin.close();
  }
}

/** Open the migrated sibling database. Call once per suite. */
export async function openApiTestDatabase(): Promise<FrankDatabaseHandle> {
  const handle = createDatabase({
    connectionString: apiDatabaseUrl() as string,
    applicationName: 'frank-api-workbench-test',
  });
  await applyMigrations(handle.db);
  return handle;
}

/**
 * Empty every table in the sibling database (restart identity, cascade).
 * Sets `session_replication_role = replica` first, because append-only
 * tables (audit_entry, run_transition, workbench_event, …) refuse TRUNCATE —
 * which is the behaviour under test, and the test harness is not a service
 * (FRANK-§11.4).
 */
export async function resetApiDatabase(db: FrankDatabase): Promise<void> {
  const rows = await db.execute<{ list: string | null }>(sql`
    select string_agg(format('%I.%I', schemaname, tablename), ', ') as list
    from pg_tables
    where schemaname = 'frank_domain'
      and tablename not in ('work_state_transition', 'run_state_transition')
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
