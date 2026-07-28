import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config.
 *
 * The contracts package is the one package in the workspace that may not import
 * anything else (FRANK-§6, `frank.mayDependOn: []`), so its test setup is kept
 * local rather than inherited from a shared workspace config that would become
 * an implicit dependency. `pnpm --filter @frank/contracts test` and
 * `turbo run test` both run in the package directory and pick this up.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
