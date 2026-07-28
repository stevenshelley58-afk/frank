import { defineConfig } from 'vitest/config';

/**
 * Package-local Vitest config, matching the convention already set by
 * `packages/contracts` and `adapters/storage/postgres`.
 *
 * Two suites live here and the split is deliberate:
 *
 *   `src/*.test.ts`             — unit tests for one mechanism at a time.
 *   `src/conformance/*.test.ts` — the eight attacks FRANK-§6.9 names as
 *                                 *mandatory* conformance tests. They are in
 *                                 their own directory so a reviewer can see at a
 *                                 glance that all eight exist and so the suite
 *                                 can be run alone as release evidence:
 *
 *                                     pnpm --filter @frank/policy exec vitest run src/conformance
 *
 * Nothing here needs a database, a network, or a clock: the engine takes `now`
 * as a parameter, so an expiry test is a pure function call and not a sleep.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
