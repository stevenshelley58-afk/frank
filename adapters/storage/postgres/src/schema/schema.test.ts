/**
 * Drift checks between the schema, the frozen contracts, and the committed
 * migration SQL. None of these needs a database — they read the definitions and
 * the `.sql` files on disk.
 *
 * The value is specific: a PostgreSQL enum and a TypeScript union that are
 * *supposed* to be the same list will stay the same only if something fails when
 * they stop being. Three places have to agree about the FRANK-§2.3 vocabulary
 * (contracts, the Drizzle enum, the generated `CREATE TYPE`) and three about the
 * WORK-004 transition table (`work-state.ts`, the seeded rows, the trigger).
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DATA_CLASS_ORDER } from '@frank/contracts';

import { WORK_STATES, legalTransitionPairs } from '../work-state.js';
import { DATA_CLASSES, POLICY_RESULTS, TRUST_LABELS, domain } from './shared.js';
import { SOURCE_LIFECYCLES } from './source.js';
import { WORK_KINDS, WORK_PRIORITIES } from './work.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
}

const SQL = migrationSql();

describe('FRANK-§2.3 vocabulary agrees with @frank/contracts', () => {
  it('lists the data classes in the contract-defined order', () => {
    expect([...DATA_CLASSES]).toEqual([...DATA_CLASS_ORDER]);
  });

  it('emits the same order into the PostgreSQL enum, so ordinality is preserved', () => {
    expect(SQL).toContain(
      `CREATE TYPE "frank_domain"."data_class" AS ENUM('open', 'internal', 'private', 'sensitive', 'secret')`,
    );
  });

  it('lists every trust label from FRANK-§2.3', () => {
    expect([...TRUST_LABELS].sort()).toEqual(
      [
        'external-untrusted',
        'generated-untrusted',
        'owner-authenticated',
        'policy-trusted',
        'verified-source',
      ].sort(),
    );
  });

  it('lists every FRANK-§6.9 policy result', () => {
    expect([...POLICY_RESULTS].sort()).toEqual(
      ['allow', 'allow_with_limits', 'deny', 'hold_for_review'].sort(),
    );
  });
});

describe('FRANK-§11.3 aggregate vocabularies', () => {
  it('uses the WorkItem.kind union verbatim', () => {
    expect([...WORK_KINDS]).toEqual([
      'task',
      'decision',
      'bug',
      'milestone',
      'follow_up',
      'routine',
      'agent_job',
    ]);
  });

  it('uses the WorkItem.priority union verbatim', () => {
    expect([...WORK_PRIORITIES]).toEqual(['none', 'low', 'normal', 'high', 'critical']);
  });

  it('uses the SourceEnvelope.lifecycle union verbatim', () => {
    expect([...SOURCE_LIFECYCLES]).toEqual([
      'active',
      'unavailable',
      'tombstoned',
      'deletion_pending',
      'deleted',
    ]);
  });
});

describe('WORK-004 state machine is the same in TypeScript and in SQL', () => {
  it('emits the work_state enum with exactly the states WORK_STATES declares', () => {
    const values = WORK_STATES.map((state) => `'${state}'`).join(', ');
    expect(SQL).toContain(`CREATE TYPE "frank_domain"."work_state" AS ENUM(${values})`);
  });

  it('seeds one row per legal transition and no others', () => {
    const seeded = [...SQL.matchAll(/^\t\('([a-z_]+)', '([a-z_]+)', '[^']*'\)/gm)].map(
      ([, from, to]) => `${from}->${to}`,
    );
    const expected = legalTransitionPairs().map(([from, to]) => `${from}->${to}`);

    expect(seeded.sort()).toEqual([...expected].sort());
    expect(seeded).toHaveLength(49);
  });

  it('installs the trigger that rejects an illegal transition in the database', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION "frank_domain"."work_state_machine_guard"()');
    expect(SQL).toContain('CREATE TRIGGER "work_item_state_machine_guard"');
    expect(SQL).toContain('BEFORE UPDATE ON "frank_domain"."work_item"');
    expect(SQL).toContain('illegal work item state transition');
  });

  it('makes the history table carry a composite foreign key onto the transition table', () => {
    expect(SQL).toContain('"work_item_transition_legal_fk"');
    expect(SQL).toMatch(
      /"work_item_transition_legal_fk" FOREIGN KEY \("from_state","to_state"\) REFERENCES "frank_domain"\."work_state_transition"\("from_state","to_state"\)/,
    );
  });
});

describe('FRANK-§11.5 append-only enforcement is in the migration, not just in code', () => {
  it('installs a row-level guard on audit_entry', () => {
    expect(SQL).toContain('CREATE TRIGGER "audit_entry_append_only"');
    expect(SQL).toContain('BEFORE UPDATE OR DELETE ON "frank_domain"."audit_entry"');
  });

  it('installs a statement-level guard against TRUNCATE, which skips row triggers', () => {
    expect(SQL).toContain('CREATE TRIGGER "audit_entry_no_truncate"');
    expect(SQL).toContain('BEFORE TRUNCATE ON "frank_domain"."audit_entry"');
  });

  it('prevents the chain head from moving backwards', () => {
    expect(SQL).toContain('CREATE TRIGGER "audit_chain_head_monotonic"');
    expect(SQL).toContain('may not move backwards');
  });

  it('makes source versions and work item history append-only too', () => {
    expect(SQL).toContain('CREATE TRIGGER "source_version_append_only"');
    expect(SQL).toContain('CREATE TRIGGER "work_item_transition_append_only"');
  });
});

describe('FIN-002: no money column may be a floating-point type', () => {
  it('declares every money and rate column as numeric with an explicit scale', () => {
    for (const column of [
      '"amount" numeric(24, 8)',
      '"unit_price" numeric(24, 10)',
      '"quantity" numeric(24, 8)',
      '"reporting_amount" numeric(24, 8)',
      '"exchange_rate" numeric(24, 12)',
      '"limit_amount" numeric(24, 8)',
      '"fraction" numeric(9, 8)',
    ]) {
      expect(SQL, column).toContain(column);
    }
  });

  it('contains no float column anywhere in the schema', () => {
    expect(SQL).not.toMatch(/\b(real|double precision|float4|float8)\b/i);
  });

  it('rejects NaN in the numeric money columns, which would poison every SUM', () => {
    expect(SQL).toContain('"cost_event_amount_is_number"');
    expect(SQL).toContain('"cost_event_quantity_is_number"');
  });
});

describe('FRANK-§11.4 database separation', () => {
  it('puts every table in the frank_domain schema', () => {
    expect(domain.schemaName).toBe('frank_domain');
    expect(SQL).toContain('CREATE SCHEMA "frank_domain"');
    // No table is created outside it.
    const tables = [...SQL.matchAll(/CREATE TABLE "([^"]+)"\."/g)].map(([, schema]) => schema);
    expect(new Set(tables)).toEqual(new Set(['frank_domain']));
  });

  it('grants nothing and creates no role — that is infrastructure, not schema', () => {
    expect(SQL).not.toMatch(/\bGRANT\b/i);
    expect(SQL).not.toMatch(/\bCREATE ROLE\b/i);
    expect(SQL).not.toMatch(/\bSUPERUSER\b/i);
  });
});

describe('FRANK-§11.1 identifiers are minted at the domain boundary', () => {
  it('gives no table a generated identifier default', () => {
    expect(SQL).not.toMatch(/"id" uuid PRIMARY KEY DEFAULT/i);
    expect(SQL).not.toMatch(/gen_random_uuid\(\)/i);
    expect(SQL).not.toMatch(/uuid_generate_v4\(\)/i);
  });
});
