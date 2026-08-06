/**
 * Integration test harness for the channels adapter — CH-02 (FRANK-§18.1
 * "Integration: real database..."), mirroring the adapters/storage/postgres
 * convention.
 *
 * The StateStore conformance gate only means anything against a real
 * PostgreSQL: row locks, `ON CONFLICT`, transactional advisory locks, and
 * `timestamptz` expiry are PostgreSQL's guarantees, not this package's. A
 * fake would agree with whatever this code believes.
 *
 * When `FRANK_TEST_DATABASE_URL` is unset, every suite here self-skips with
 * a visible reason rather than passing; `vitest run` prints the skipped
 * files, so "no database" never looks like "everything is fine".
 *
 * Set it to a database the tests may freely truncate:
 *
 *     FRANK_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:15434/frank_test pnpm test
 */

import { createPostgresStateStore, type PostgresStateStore } from '../state-store.js';

export const DATABASE_URL = process.env['FRANK_TEST_DATABASE_URL'];

/** `true` when integration tests must be skipped. Pass to `describe.skipIf`. */
export const requiresDatabase = DATABASE_URL === undefined || DATABASE_URL === '';

export const SKIP_REASON =
  'requires a live PostgreSQL: set FRANK_TEST_DATABASE_URL to a database this test may truncate';

let store: PostgresStateStore | undefined;

/** Open (once per worker) a migrated state store. */
export async function openTestStore(): Promise<PostgresStateStore> {
  if (DATABASE_URL === undefined || DATABASE_URL === '') {
    throw new Error(`openTestStore() called without FRANK_TEST_DATABASE_URL. ${SKIP_REASON}.`);
  }
  if (store === undefined) {
    store = await createPostgresStateStore({
      connectionString: DATABASE_URL,
      schema: 'frank_channels_test',
      applicationName: 'frank-channels-conformance',
    });
  }
  return store;
}

export async function closeTestStore(): Promise<void> {
  if (store !== undefined) {
    await store.close();
    store = undefined;
  }
}
