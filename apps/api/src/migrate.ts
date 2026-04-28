import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPgPool, waitForPostgres } from "./db.js";

interface QueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface MigrationQueryable {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

export interface MigrationClient extends MigrationQueryable {
  release(): void;
}

export interface MigrationPool extends MigrationQueryable {
  connect(): Promise<MigrationClient>;
}

export interface MigrationFile {
  filename: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunOptions {
  migrationsDir?: string;
  logger?: Pick<Console, "log" | "error">;
}

type MigrationAuditOutcome = "success" | "failure";

export async function runMigrations(pool: MigrationPool, options: MigrationRunOptions = {}): Promise<void> {
  const logger = options.logger ?? console;
  const migrationsDir = options.migrationsDir ?? resolveMigrationsDir();
  const migrations = await readMigrationFiles(migrationsDir);

  await ensureSchemaMigrationsTable(pool, migrations);

  for (const migration of migrations) {
    const applied = await pool.query<{ checksum: string }>(
      "select checksum from schema_migrations where filename = $1",
      [migration.filename]
    );

    const appliedChecksum = applied.rows[0]?.checksum;
    if (appliedChecksum) {
      if (appliedChecksum !== migration.checksum) {
        await recordMigrationAudit(pool, {
          action: "migration.checksum_mismatch",
          filename: migration.filename,
          checksum: migration.checksum,
          outcome: "failure",
          metadata: {
            appliedChecksum,
            currentChecksum: migration.checksum
          }
        }).catch((error) => {
          logger.error(error);
        });
        throw new Error(
          `Migration checksum mismatch for ${migration.filename}. Applied checksum ${appliedChecksum}, current checksum ${migration.checksum}. Refusing to run.`
        );
      }
      continue;
    }

    await recordMigrationAudit(pool, {
      action: "migration.start",
      filename: migration.filename,
      checksum: migration.checksum,
      outcome: "success"
    });

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(migration.sql);
      await client.query("insert into schema_migrations (filename, checksum) values ($1, $2)", [
        migration.filename,
        migration.checksum
      ]);
      await recordMigrationAudit(client, {
        action: "migration.success",
        filename: migration.filename,
        checksum: migration.checksum,
        outcome: "success"
      });
      await client.query("commit");
      logger.log(`applied migration ${migration.filename}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      await recordMigrationAudit(pool, {
        action: "migration.failure",
        filename: migration.filename,
        checksum: migration.checksum,
        outcome: "failure",
        metadata: {
          message: error instanceof Error ? error.message : "Unknown migration failure"
        }
      }).catch((auditError) => {
        logger.error(auditError);
      });
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function readMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(migrationsDir, filename);
      const sql = await readFile(filePath, "utf8");
      return {
        filename,
        path: filePath,
        sql,
        checksum: checksumSql(sql)
      };
    })
  );
}

export function checksumSql(sql: string): string {
  return `sha256:${createHash("sha256").update(sql).digest("hex")}`;
}

export async function ensureSchemaMigrationsTable(
  pool: MigrationQueryable,
  migrations: readonly MigrationFile[]
): Promise<void> {
  const columns = await getSchemaMigrationColumns(pool);

  if (columns.size === 0) {
    await pool.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
  } else if (!columns.has("filename") && columns.has("id")) {
    await pool.query("alter table schema_migrations rename column id to filename");
  } else if (!columns.has("filename")) {
    throw new Error("schema_migrations exists but has neither filename nor legacy id column.");
  }

  await pool.query("alter table schema_migrations add column if not exists checksum text");
  await pool.query("alter table schema_migrations add column if not exists applied_at timestamptz not null default now()");

  const checksumsByFilename = new Map(migrations.map((migration) => [migration.filename, migration.checksum]));
  for (const [filename, checksum] of checksumsByFilename) {
    await pool.query("update schema_migrations set checksum = $2 where filename = $1 and checksum is null", [
      filename,
      checksum
    ]);
  }

  const missingChecksums = await pool.query<{ filename: string }>(
    "select filename from schema_migrations where checksum is null"
  );
  if (missingChecksums.rows.length > 0) {
    const filenames = missingChecksums.rows.map((row) => row.filename).join(", ");
    throw new Error(`Cannot backfill schema_migrations checksums for missing migration file(s): ${filenames}`);
  }

  await pool.query("alter table schema_migrations alter column checksum set not null");
}

export function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), "infra/postgres/migrations"),
    path.resolve(process.cwd(), "../../infra/postgres/migrations"),
    path.resolve(here, "../../../infra/postgres/migrations"),
    path.resolve(here, "../../infra/postgres/migrations")
  ].filter((candidate): candidate is string => Boolean(candidate));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Could not find migrations directory. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

async function getSchemaMigrationColumns(pool: MigrationQueryable): Promise<Set<string>> {
  const result = await pool.query<{ column_name: string }>(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'schema_migrations'
    `
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function recordMigrationAudit(
  db: MigrationQueryable,
  event: {
    action: string;
    filename: string;
    checksum: string;
    outcome: MigrationAuditOutcome;
    metadata?: Record<string, unknown>;
  }
): Promise<boolean> {
  const auditTable = await db.query<{ audit_log: string | null }>(
    "select to_regclass('public.audit_log')::text as audit_log"
  );
  if (!auditTable.rows[0]?.audit_log) {
    return false;
  }

  await db.query(
    `
      insert into audit_log (
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        outcome,
        metadata
      )
      values ('system', 'migrate', $1, 'migration', $2, $3, $4::jsonb)
    `,
    [
      event.action,
      event.filename,
      event.outcome,
      JSON.stringify({
        checksum: event.checksum,
        ...(event.metadata ?? {})
      })
    ]
  );
  return true;
}

async function runCli(): Promise<void> {
  const config = loadConfig();
  const pool = createPgPool(config.databaseUrl);
  try {
    await waitForPostgres(pool);
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
