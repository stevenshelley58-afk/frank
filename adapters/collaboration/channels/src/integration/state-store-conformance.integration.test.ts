/**
 * CH-02 hard gate: the channel runtime's own StateStore conformance suite
 * (`runStateStoreConformance` from `@copilotkit/channels/testing`, SDK pinned
 * exactly to 0.7.3) run against a real PostgreSQL.
 *
 * The suite covers key-value (round-trip, TTL expiry, atomic one-shot
 * consume), list (ordering, maxLen cap dropping oldest, trim, whole-list
 * expiry preservation), lock (mutual exclusion, stale-token safety,
 * TTL-based takeover), deduplication (first-false/second-true within TTL,
 * forgetting after TTL), and queue (FIFO, depth, maxSize overflow with
 * drop-oldest and drop-newest), plus keyspace isolation between kv and lock.
 *
 * Conformance MUST pass against real Postgres before CH-03/CH-04 may start
 * against production code (M4). Without `FRANK_TEST_DATABASE_URL` this file
 * self-skips with a visible reason (repo convention); it never passes
 * silently.
 */

import { afterAll, describe } from 'vitest';

import { runStateStoreConformance } from '@copilotkit/channels/testing';

import { closeTestStore, openTestStore, requiresDatabase, SKIP_REASON } from './harness.js';

describe.skipIf(requiresDatabase)(
  `Postgres StateStore conformance against real PostgreSQL (${SKIP_REASON})`,
  () => {
    afterAll(async () => {
      await closeTestStore();
    });

    // One migrated store per worker; the conformance suite calls `make`
    // before every test, so each test starts from a known-empty store.
    runStateStoreConformance('PostgresStateStore', async () => {
      const store = await openTestStore();
      await store.truncateAll();
      return store;
    });
  },
);
