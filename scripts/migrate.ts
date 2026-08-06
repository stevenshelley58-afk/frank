/**
 * One-shot migrator for a FRANK PostgreSQL database.
 *
 * Why this exists: drizzle's migrator sends each migration statement as its
 * own round trip (~210 statements across 0000–0004). Against the local test
 * server reached through the SSH tunnel on :15434 each round trip costs
 * ~300 ms, so a cold migration takes 2–3 minutes. That exceeds any sane
 * `beforeAll` timeout, which is why the workbench integration suite appeared
 * to "hang" on first run (it was migrating, just slower than the timeout).
 *
 * Run this once per database; `applyMigrations` inside tests then finds the
 * journal already current and finishes in milliseconds.
 *
 *   node --experimental-strip-types scripts/migrate.ts <connection-string>
 *
 * FRANK-§11.4: this tool is a release/test credential, never something a
 * running service calls.
 */
import { applyMigrations, createDatabase } from '../adapters/storage/postgres/src/db.ts';

const connectionString = process.argv[2];
if (!connectionString) {
  console.error('usage: migrate.ts <postgresql://...>');
  process.exit(2);
}

const handle = createDatabase({
  connectionString,
  applicationName: 'frank-migrate-cli',
  statementTimeoutMs: 60_000,
});

const t0 = Date.now();
try {
  console.error(`migrating ${connectionString.replace(/\/\/([^@/]+)@/, '//***@')} ...`);
  await applyMigrations(handle.db);
  console.error(`migrations applied in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await handle.close();
  process.exit(0);
} catch (error) {
  console.error('migration failed:', error);
  await handle.close();
  process.exit(1);
}
