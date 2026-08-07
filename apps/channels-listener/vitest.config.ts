import { defineConfig } from 'vitest/config';

/**
 * CH-05: SDK telemetry must stay disabled in every test run this package
 * performs. Setting it in the vitest env mirrors the deployment assertion.
 */
export default defineConfig({
  test: {
    environment: 'node',
    env: {
      COPILOTKIT_TELEMETRY_DISABLED: 'true',
    },
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
