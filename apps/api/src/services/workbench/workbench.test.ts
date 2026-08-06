/**
 * WB-01 drift checks: migration `0004_workbench.sql` vs `types.ts`.
 *
 * Same discipline as `adapters/storage/postgres/src/schema/schema.test.ts`:
 * a PostgreSQL enum and a TypeScript union that are supposed to be the same
 * list will stay the same list only if something fails when they stop being.
 * No database needed — this reads the committed `.sql` and `_journal.json`
 * from disk.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WORKBENCH_EVENT_TYPES,
  WORKBENCH_PLAN_STEP_STATES,
  WORKBENCH_STATES,
} from './types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(
  HERE,
  '../../../../../adapters/storage/postgres/migrations',
);

/* Windows checkouts materialize the .sql files as CRLF (core.autocrlf=true);
 * canonicalize to LF so the suite passes identically on both platforms —
 * same fix as schema.test.ts. */
const SQL_0004 = readFileSync(path.join(MIGRATIONS_DIR, '0004_workbench.sql'), 'utf8').replace(
  /\r\n?/g,
  '\n',
);
const JOURNAL = JSON.parse(
  readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> };

describe('WB-01: workbench vocabularies agree between types.ts and migration 0004', () => {
  it('emits workbench_state with exactly WORKBENCH_STATES, in lifecycle order', () => {
    const values = WORKBENCH_STATES.map((state) => `    '${state}'`).join(',\n');
    expect(SQL_0004).toContain(
      `CREATE TYPE "frank_domain"."workbench_state" AS ENUM(\n${values}\n)`,
    );
  });

  it('emits workbench_event_type with exactly the §4.2 fixed event list', () => {
    const values = WORKBENCH_EVENT_TYPES.map((type) => `    '${type}'`).join(',\n');
    expect(SQL_0004).toContain(
      `CREATE TYPE "frank_domain"."workbench_event_type" AS ENUM(\n${values}\n)`,
    );
    // §4.2 semantics are fixed: the list must stay exactly these 15.
    expect(WORKBENCH_EVENT_TYPES).toHaveLength(15);
  });

  it('emits workbench_plan_step_state with exactly the §3.4 step states', () => {
    const values = WORKBENCH_PLAN_STEP_STATES.map((state) => `    '${state}'`).join(',\n');
    expect(SQL_0004).toContain(
      `CREATE TYPE "frank_domain"."workbench_plan_step_state" AS ENUM(\n${values}\n)`,
    );
  });
});

describe('WB-01: idempotent creation and durable event order are in the migration', () => {
  it('makes creation idempotent against the delegation command key', () => {
    expect(SQL_0004).toContain(
      'CREATE UNIQUE INDEX "workbench_idem_uidx" ON "frank_domain"."workbench" USING btree ("cell_id","idempotency_key")',
    );
  });

  it('makes the event log append-only, including against TRUNCATE', () => {
    expect(SQL_0004).toContain('CREATE TRIGGER "workbench_event_append_only"');
    expect(SQL_0004).toContain('BEFORE UPDATE OR DELETE ON "frank_domain"."workbench_event"');
    expect(SQL_0004).toContain('CREATE TRIGGER "workbench_event_no_truncate"');
    expect(SQL_0004).toContain('BEFORE TRUNCATE ON "frank_domain"."workbench_event"');
  });

  it('links the workbench to its work item with a restricting FK', () => {
    expect(SQL_0004).toMatch(
      /"workbench_work_item_id_work_item_id_fk" FOREIGN KEY \("work_item_id"\) REFERENCES "frank_domain"\."work_item"\("id"\) ON DELETE restrict/,
    );
  });

  it('gives no table a generated identifier default (FRANK-§11.1)', () => {
    expect(SQL_0004).not.toMatch(/"id" uuid PRIMARY KEY DEFAULT/i);
    expect(SQL_0004).not.toMatch(/gen_random_uuid\(\)/i);
  });

  it('keeps every table in the frank_domain schema', () => {
    const tables = [...SQL_0004.matchAll(/CREATE TABLE "([^"]+)"\."/g)].map(([, schema]) => schema);
    expect(new Set(tables)).toEqual(new Set(['frank_domain']));
  });

  it('carries rollback instructions (WB-01 rule)', () => {
    expect(SQL_0004).toMatch(/ROLLBACK/i);
    expect(SQL_0004).toContain('DROP TABLE "frank_domain"."workbench"');
  });
});

describe('WB-01: the migration journal follows the existing convention', () => {
  it('registers 0004_workbench as idx 4', () => {
    const entry = JOURNAL.entries.find((e) => e.tag === '0004_workbench');
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(4);
  });

  it('keeps the journal strictly increasing by idx', () => {
    const indexes = JOURNAL.entries.map((e) => e.idx);
    expect(indexes).toEqual(indexes.map((_, i) => i));
  });
});
