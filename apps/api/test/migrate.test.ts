import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checksumSql, runMigrations, type MigrationClient, type MigrationPool } from "../src/migrate.js";

const requiredTaskStates = [
  "draft",
  "queued",
  "running",
  "blocked",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled"
] as const;

const requiredPermissionLevels = ["denied", "auto", "auto_review", "manual"] as const;

const quietLogger = {
  log() {
    return undefined;
  },
  error() {
    return undefined;
  }
};

describe("migration runner", () => {
  it("applies migrations on an empty database", async () => {
    const migrationsDir = await createMigrationDir({
      "001_first.sql": "select 1;",
      "002_audit_log.sql": "create table if not exists audit_log (id text);"
    });
    const db = new FakeMigrationPool();

    await runMigrations(db, { migrationsDir, logger: quietLogger });

    expect([...db.applied.keys()]).toEqual(["001_first.sql", "002_audit_log.sql"]);
    expect(db.executedMigrationSql).toHaveLength(2);
    expect(db.applied.get("001_first.sql")).toBe(checksumSql("select 1;"));
    expect(db.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "migration.success",
          targetId: "002_audit_log.sql",
          outcome: "success"
        })
      ])
    );
  });

  it("does not reapply already-applied migrations with matching checksums", async () => {
    const migrationsDir = await createMigrationDir({
      "001_first.sql": "select 1;",
      "002_second.sql": "select 2;"
    });
    const db = new FakeMigrationPool();

    await runMigrations(db, { migrationsDir, logger: quietLogger });
    const executedAfterFirstRun = db.executedMigrationSql.length;

    await runMigrations(db, { migrationsDir, logger: quietLogger });

    expect(db.executedMigrationSql).toHaveLength(executedAfterFirstRun);
    expect([...db.applied.keys()]).toEqual(["001_first.sql", "002_second.sql"]);
  });

  it("detects checksum mismatches and fails closed", async () => {
    const migrationsDir = await createMigrationDir({
      "001_first.sql": "select 1;"
    });
    const db = new FakeMigrationPool();

    await runMigrations(db, { migrationsDir, logger: quietLogger });
    await writeFile(path.join(migrationsDir, "001_first.sql"), "select 42;");

    await expect(runMigrations(db, { migrationsDir, logger: quietLogger })).rejects.toThrow(
      /Migration checksum mismatch for 001_first\.sql/
    );
    expect(db.executedMigrationSql).toEqual(["select 1;"]);
  });

  it("upgrades legacy schema_migrations rows by backfilling checksums", async () => {
    const migrationsDir = await createMigrationDir({
      "001_first.sql": "select 1;"
    });
    const db = new FakeMigrationPool({
      legacyApplied: ["001_first.sql"]
    });

    await runMigrations(db, { migrationsDir, logger: quietLogger });

    expect(db.columns.has("id")).toBe(false);
    expect(db.columns.has("filename")).toBe(true);
    expect(db.applied.get("001_first.sql")).toBe(checksumSql("select 1;"));
    expect(db.executedMigrationSql).toHaveLength(0);
  });
});

describe("Stage 2 schema migration", () => {
  it("keeps model and agent seed data idempotent", async () => {
    const modelSeedSql = await readMigration("004_seed_model_control_plane.sql");
    const coreSchemaSql = await readMigration("005_core_task_schema.sql");

    expect(modelSeedSql).toContain("on conflict (id) do update");
    expect(modelSeedSql).toContain("where not exists");
    expect(coreSchemaSql).toContain("on conflict (id) do update");
    expect(coreSchemaSql).toContain("where agents.display_name is distinct from excluded.display_name");
  });

  it("defines the required task states and permission levels in check constraints", async () => {
    const coreSchemaSql = await readMigration("005_core_task_schema.sql");

    expect(coreSchemaSql).toContain("constraint tasks_state_check");
    expect(coreSchemaSql).toContain("constraint agent_permissions_level_check");

    for (const state of requiredTaskStates) {
      expect(coreSchemaSql).toContain(`'${state}'`);
    }
    for (const level of requiredPermissionLevels) {
      expect(coreSchemaSql).toContain(`'${level}'`);
    }
  });
});

class FakeMigrationPool implements MigrationPool {
  readonly columns = new Set<string>();
  readonly applied = new Map<string, string | null>();
  readonly executedMigrationSql: string[] = [];
  readonly audits: Array<{ action: string; targetId: string; outcome: string; metadata: unknown }> = [];
  auditLogExists = false;

  constructor(options: { legacyApplied?: string[] } = {}) {
    if (options.legacyApplied) {
      this.columns.add("id");
      this.columns.add("applied_at");
      for (const filename of options.legacyApplied) {
        this.applied.set(filename, null);
      }
    }
  }

  async connect(): Promise<MigrationClient> {
    return {
      query: this.query.bind(this),
      release() {
        return undefined;
      }
    };
  }

  async query<Row = Record<string, unknown>>(text: string, values?: unknown[]) {
    const rows = this.handleQuery(text, values) as Row[];
    return {
      rows,
      rowCount: rows.length
    };
  }

  private handleQuery(text: string, values: unknown[] = []): unknown[] {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.includes("from information_schema.columns")) {
      return [...this.columns].map((columnName) => ({ column_name: columnName }));
    }

    if (normalized.startsWith("create table if not exists schema_migrations")) {
      if (this.columns.size === 0) {
        this.columns.add("filename");
        this.columns.add("checksum");
        this.columns.add("applied_at");
      }
      return [];
    }

    if (normalized === "alter table schema_migrations rename column id to filename") {
      this.columns.delete("id");
      this.columns.add("filename");
      return [];
    }

    if (normalized.startsWith("alter table schema_migrations add column if not exists checksum")) {
      this.columns.add("checksum");
      return [];
    }

    if (normalized.startsWith("alter table schema_migrations add column if not exists applied_at")) {
      this.columns.add("applied_at");
      return [];
    }

    if (normalized.startsWith("update schema_migrations set checksum")) {
      const [filename, checksum] = values as [string, string];
      if (this.applied.has(filename) && this.applied.get(filename) === null) {
        this.applied.set(filename, checksum);
      }
      return [];
    }

    if (normalized === "select filename from schema_migrations where checksum is null") {
      return [...this.applied.entries()]
        .filter(([, checksum]) => checksum === null)
        .map(([filename]) => ({ filename }));
    }

    if (normalized === "alter table schema_migrations alter column checksum set not null") {
      const missing = [...this.applied.values()].some((checksum) => checksum === null);
      if (missing) {
        throw new Error("checksum contains null values");
      }
      return [];
    }

    if (normalized === "select checksum from schema_migrations where filename = $1") {
      const [filename] = values as [string];
      const checksum = this.applied.get(filename);
      return checksum ? [{ checksum }] : [];
    }

    if (normalized === "select to_regclass('public.audit_log')::text as audit_log") {
      return [{ audit_log: this.auditLogExists ? "audit_log" : null }];
    }

    if (normalized.startsWith("insert into audit_log")) {
      const [action, targetId, outcome, metadata] = values as [string, string, string, string];
      this.audits.push({
        action,
        targetId,
        outcome,
        metadata: JSON.parse(metadata)
      });
      return [];
    }

    if (normalized === "begin" || normalized === "commit" || normalized === "rollback") {
      return [];
    }

    if (normalized.startsWith("insert into schema_migrations")) {
      const [filename, checksum] = values as [string, string];
      this.applied.set(filename, checksum);
      return [];
    }

    if (normalized.includes("create table if not exists audit_log")) {
      this.auditLogExists = true;
    }
    this.executedMigrationSql.push(text);
    return [];
  }
}

async function createMigrationDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "frank-migrations-"));
  await Promise.all(Object.entries(files).map(([filename, contents]) => writeFile(path.join(dir, filename), contents)));
  return dir;
}

async function readMigration(filename: string): Promise<string> {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  return readFile(path.resolve(testDir, "../../../infra/postgres/migrations", filename), "utf8");
}
