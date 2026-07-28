import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config.
 *
 * Two suites live here and they are deliberately distinguishable:
 *
 *   `src/**\/*.test.ts`                        — pure logic. No database, no
 *                                                network, no clock dependency.
 *   `src/integration/**\/*.integration.test.ts` — real PostgreSQL. Every file in
 *                                                that directory self-skips with a
 *                                                visible reason when
 *                                                `FRANK_TEST_DATABASE_URL` is unset.
 *
 * The split is a FRANK-§18.1 requirement, not a convenience: the "Static" and
 * "Unit" layers must be runnable in continuous integration with no service
 * dependencies, while the invariants that only PostgreSQL can enforce (append-only
 * audit triggers, the work-state transition trigger, transaction rollback) must be
 * proven against PostgreSQL rather than a mock that would agree with itself.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; running files in parallel would let
    // two suites truncate each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
