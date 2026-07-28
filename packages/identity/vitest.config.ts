import { defineConfig } from 'vitest/config';

/** Package-local config, matching `packages/contracts`. No database, no network. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
