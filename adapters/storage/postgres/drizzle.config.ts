import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration — FRANK-§17.3 ("Drizzle for explicit PostgreSQL
 * schemas and migrations").
 *
 * `migrations` are generated with `pnpm --filter @frank/adapter-postgres db:generate`
 * and committed. They are never applied from a developer's machine against a
 * shared environment: FRANK-§11.4 requires migration identities to be "separate,
 * short-lived, and only available to the release workflow", so this file
 * deliberately has no `dbCredentials` block and `drizzle-kit push` is not wired
 * to a script. The connection string is supplied by the release workflow at
 * apply time.
 *
 * `strict` and `verbose` are on so a generated migration that would drop a
 * column has to be read and confirmed rather than scrolled past.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['frank_domain'],
  strict: true,
  verbose: true,
  breakpoints: true,
});
