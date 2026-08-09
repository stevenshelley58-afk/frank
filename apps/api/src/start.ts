/**
 * Startup script — runs migrations then starts the API server.
 *
 * Uses @frank/adapter-postgres's own pg dependency (not a direct import)
 * to respect FRANK-§17.2's provider SDK boundary.
 */

const DATABASE_URL = process.env.FRANK_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!DATABASE_URL) {
  console.error('FRANK_DATABASE_URL (or legacy DATABASE_URL) is required');
  process.exit(2);
}

async function runMigrations(): Promise<void> {
  // Use the adapter-postgres package which already depends on pg + drizzle-orm
  const { createDatabase, applyMigrations } = await import(
    '@frank/adapter-postgres'
  );

  const { db, close } = createDatabase({
    connectionString: DATABASE_URL,
    applicationName: 'frank-migrate',
  });

  try {
    console.log('[start] applying migrations...');
    await applyMigrations(db);
    console.log('[start] migrations applied');
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  await runMigrations();
  console.log('[start] starting frank-api...');
  await import('./main.js');
}

main().catch((error) => {
  console.error('[start] failed:', error);
  process.exit(1);
});
