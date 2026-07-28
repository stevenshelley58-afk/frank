import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config.
 *
 * Two suites, split the same way `adapters/storage/postgres` splits its own,
 * and for the same FRANK-§18.1 reason:
 *
 *   `src/test/*.test.ts`                        — in-process HTTP through
 *                                                 `app.inject()`, with the store
 *                                                 behind a fake. No database.
 *   `src/test/*.integration.test.ts`            — real PostgreSQL. Self-skips
 *                                                 with a visible reason when
 *                                                 `FRANK_TEST_DATABASE_URL` is unset.
 *
 * The UX-004 latency requirement is tested in *both*: the no-database test
 * proves the architectural property (the request path does not await
 * enrichment), and the database test measures the real number at the API
 * boundary. Either alone would be misleading — a fake store can always be fast,
 * and a real measurement does not prove the enrichment path is off the request
 * path.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
