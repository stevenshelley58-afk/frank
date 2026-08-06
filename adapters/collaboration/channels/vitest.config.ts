import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config (CH-02).
 *
 *   `src/**\/*.test.ts`                        — pure logic. No database.
 *   `src/**\/*.integration.test.ts`            — real PostgreSQL. Self-skips
 *                                                with a visible reason when
 *                                                `FRANK_TEST_DATABASE_URL` is
 *                                                unset (repo convention, see
 *                                                adapters/storage/postgres).
 *
 * CH-05 / M12: telemetry from the channel SDK stays disabled in every test
 * run this package performs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      COPILOTKIT_TELEMETRY_DISABLED: 'true',
    },
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; parallel files would truncate
    // each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
