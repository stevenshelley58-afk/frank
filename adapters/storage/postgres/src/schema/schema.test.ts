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

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DATA_CLASS_ORDER, MAX_CHAT_TURN_ATTACHMENTS, normalizeSourceRef } from '@frank/contracts';

import { WORK_STATES, legalTransitionPairs } from '../work-state.js';
import { RUN_STATES, legalRunTransitionPairs } from '../run-state.js';
import { MISSION_STATES, ROOM_STATES } from './room-mission.js';
import { DATA_CLASSES, POLICY_RESULTS, TRUST_LABELS, domain } from './shared.js';
import { SOURCE_LIFECYCLES } from './source.js';
import { WORK_KINDS, WORK_PRIORITIES } from './work.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/* Windows checkouts (core.autocrlf=true) materialize the .sql files as CRLF
 * while the assertions below compare against LF strings; canonicalize to LF
 * on read so the suite passes identically on Windows and Linux (Track B1
 * CI parity — same fix as tools/registry/generate-registry.mjs). */
const readSql = (file: string) =>
  readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n?/g, '\n');

function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readSql(name))
    .join('\n');
}

/** Read one migration file by its numeric prefix, e.g. singleMigrationSql('0001'). */
function singleMigrationSql(prefix: string): string {
  const name = readdirSync(MIGRATIONS_DIR).find((n) => n.startsWith(prefix) && n.endsWith('.sql'));
  if (name === undefined) throw new Error(`no migration starting with ${prefix} in ${MIGRATIONS_DIR}`);
  return readSql(name);
}

const SQL = migrationSql();
const SQL_0001 = singleMigrationSql('0001');
const SQL_0002 = singleMigrationSql('0002');
const SQL_0009 = singleMigrationSql('0009');
const SQL_0011 = singleMigrationSql('0011');
const SQL_0013 = singleMigrationSql('0013');
const CONTRACT_SCHEMAS_DIR = path.resolve(MIGRATIONS_DIR, '../../../../packages/contracts/schemas');

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
    // Scoped to 0001: the run_state_transition seed in 0002 uses the same
    // `('from', 'to', 'label')` row shape, so reading the joined SQL would
    // double-count. Each transition table is checked against its own migration.
    const seeded = [...SQL_0001.matchAll(/^\t\('([a-z_]+)', '([a-z_]+)', '[^']*'\)/gm)].map(
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

describe('FRANK-§7.3 run state machine is the same in TypeScript and in SQL', () => {
  it('emits the run_state enum with exactly the states RUN_STATES declares', () => {
    const values = RUN_STATES.map((state) => `'${state}'`).join(',\n    ');
    expect(SQL_0002).toContain(`CREATE TYPE "frank_domain"."run_state" AS ENUM(\n    ${values}\n)`);
  });

  it('seeds one row per legal run transition and no others', () => {
    const seeded = [...SQL_0002.matchAll(/^\t\('([a-z_]+)', '([a-z_]+)', '[^']*'\)/gm)].map(
      ([, from, to]) => `${from}->${to}`,
    );
    const expected = legalRunTransitionPairs().map(([from, to]) => `${from}->${to}`);

    expect(seeded.sort()).toEqual([...expected].sort());
    expect(seeded).toHaveLength(41);
  });

  it('installs the trigger that rejects an illegal run transition in the database', () => {
    expect(SQL_0002).toContain('CREATE OR REPLACE FUNCTION "frank_domain"."run_state_machine_guard"()');
    expect(SQL_0002).toContain('CREATE TRIGGER "run_state_machine_guard"');
    expect(SQL_0002).toContain('BEFORE UPDATE ON "frank_domain"."run"');
    expect(SQL_0002).toContain('illegal run state transition');
  });

  it('makes the run history table carry a composite foreign key onto the transition table', () => {
    expect(SQL_0002).toContain('"run_transition_legal_fk"');
    expect(SQL_0002).toMatch(
      /"run_transition_legal_fk" FOREIGN KEY \("from_state","to_state"\) REFERENCES "frank_domain"\."run_state_transition"\("from_state","to_state"\)/,
    );
  });

  it('makes run history append-only, including against TRUNCATE', () => {
    expect(SQL_0002).toContain('CREATE TRIGGER "run_transition_append_only"');
    expect(SQL_0002).toContain('BEFORE UPDATE OR DELETE ON "frank_domain"."run_transition"');
    expect(SQL_0002).toContain('CREATE TRIGGER "run_transition_no_truncate"');
    expect(SQL_0002).toContain('BEFORE TRUNCATE ON "frank_domain"."run_transition"');
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

describe('autonomous room and mission schema', () => {
  it('keeps room and mission lifecycle enums aligned with migration 0009', () => {
    expect([...ROOM_STATES]).toEqual(['active', 'completed', 'failed', 'cancelled']);
    expect([...MISSION_STATES]).toEqual([
      'planning',
      'running',
      'waiting',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(SQL_0009).toContain(
      `CREATE TYPE "frank_domain"."room_state" AS ENUM('active', 'completed', 'failed', 'cancelled')`,
    );
    expect(SQL_0009).toContain(
      `CREATE TYPE "frank_domain"."mission_state" AS ENUM('planning', 'running', 'waiting', 'completed', 'failed', 'cancelled')`,
    );
  });

  it('links a mission to its room and canonical root work item', () => {
    expect(SQL_0009).toContain(
      '"mission_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "frank_domain"."room"("id") ON DELETE restrict',
    );
    expect(SQL_0009).toContain(
      '"mission_root_work_item_id_work_item_id_fk" FOREIGN KEY ("root_work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict',
    );
    expect(SQL_0009).toContain('"mission_root_work_item_uidx"');
  });

  it('deduplicates mission creation by cell and idempotency key', () => {
    expect(SQL_0009).toContain(
      'CREATE UNIQUE INDEX "mission_cell_idempotency_uidx" ON "frank_domain"."mission" USING btree ("cell_id", "idempotency_key")',
    );
  });

  it('enforces bounded execution, terminal stop, and optimistic concurrency', () => {
    for (const constraint of [
      '"mission_spend_limit_non_negative"',
      '"mission_token_limit_non_negative"',
      '"mission_wall_clock_limit_positive"',
      '"mission_attempt_limit_positive"',
      '"mission_terminal_finished_paired"',
      '"mission_terminal_stops_new_work"',
      '"mission_version_positive"',
      '"room_version_positive"',
    ]) {
      expect(SQL_0009, constraint).toContain(constraint);
    }
  });

  it('contains no seed/demo rows or generated identifier defaults', () => {
    expect(SQL_0009).not.toMatch(/\bINSERT\b/i);
    expect(SQL_0009).not.toMatch(/gen_random_uuid\(\)|uuid_generate_v4\(\)/i);
  });
});

describe('Wave 1 harness migration parity', () => {
  it('keeps the one and only room composite key in 0011 and the Drizzle room model', () => {
    expect((SQL_0011.match(/room_id_cell_uidx/g) ?? [])).toHaveLength(1);
    expect(SQL_0011).toContain('CREATE UNIQUE INDEX "room_id_cell_uidx" ON "frank_domain"."room" ("id", "cell_id")');
  });

  it('uses composite cell-scoped foreign keys for live chat, room, turn, jobs, and attachment ownership', () => {
    for (const name of [
      'room_route_policy_room_cell_fk', 'chat_turn_conversation_cell_fk', 'chat_turn_room_cell_fk',
      'chat_turn_user_message_cell_fk', 'chat_turn_assistant_message_cell_fk', 'chat_turn_event_turn_cell_fk',
      'harness_job_room_cell_fk', 'harness_job_event_job_cell_fk', 'attachment_conversation_cell_fk',
      'attachment_message_cell_fk', 'attachment_turn_cell_fk', 'attachment_reservation_cell_fk',
      'attachment_object_cell_fk', 'attachment_outbox_attachment_cell_fk',
    ]) expect(SQL, name).toContain(name);
  });

  it('gives every composite FK target a matching non-partial unique key before PostgreSQL applies it', () => {
    for (const target of [
      'room_id_cell_uidx', 'chat_conversation_id_cell_uidx', 'chat_message_id_cell_uidx',
      'chat_turn_id_cell_uidx', 'harness_job_id_cell_uidx', 'upload_reservation_id_cell_uidx',
      'object_manifest_id_cell_uidx', 'attachment_id_cell_uidx',
    ]) expect(SQL, target).toContain(target);
  });

  it('makes rollback and session ancestry stay inside the same cell and harness', () => {
    expect(SQL_0011).toContain('harness_config_revision_rollback_fk');
    expect(SQL_0011).toContain('harness_session_lineage_parent_fk');
    expect(SQL_0011).toContain('harness_activation_audit_revision_cell_harness_fk');
  });

  it('enforces exact terminal-state pairing, strict health TTL, and atomic request hashes', () => {
    for (const constraint of [
      'chat_turn_terminal_finished_paired', 'chat_turn_cancelled_state_paired',
      'harness_job_terminal_finished_paired', 'harness_job_cancelled_state_paired',
      'harness_health_ttl_strict', 'chat_turn_request_hash', 'harness_job_request_hash',
      'upload_reservation_idempotency_uidx', 'upload_reservation_expiry_24h',
    ]) expect(SQL, constraint).toContain(constraint);
  });

  it('models separate 2 GiB-file, 50 GiB-cell, 10 GiB/10k-message, and 30 GiB-host-free limits', () => {
    expect(SQL_0013).toContain('2147483648');
    expect(SQL_0013).toContain('53687091200');
    expect(SQL_0013).toContain('10737418240');
    expect(SQL_0013).toContain('10000');
    expect(SQL_0013).toContain('32212254720');
    expect(SQL_0013).toContain('attachment_host_free_observation');
  });

  it('keeps attachment lifecycle and outbox vocabulary aligned around hash_scan_promote', () => {
    expect(SQL_0013).toContain("'hash_scan_promote','extract','cleanup','reconcile'");
    expect(SQL_0013).toContain("'pending','leased','completed','failed','cancelled'");
    expect(SQL_0013).toContain('attachment_state_consistent');
  });

  it('keeps draft-message quota pre-send and canonical manifest payload checks database-enforced', () => {
    expect(SQL_0013).toContain('draft_message_id');
    expect(SQL_0013).not.toContain('attachment_message_quota_message_cell_fk');
    expect(SQL_0013).toContain('object_manifest_canonical_payload');
    expect(SQL_0013).toContain('jsonb_typeof("source_ref"->\'kind\') = \'string\'');
  });
});

describe('Wave 1 frozen contracts', () => {
  it('normalizes numeric source versions but never permits blank identities', () => {
    expect(normalizeSourceRef({ kind: 'source', id: 'abc', version: 7 })).toEqual({ kind: 'source', id: 'abc', version: '7' });
    expect(() => normalizeSourceRef({ kind: ' ', id: 'abc' })).toThrow('SourceRef.kind');
    expect(() => normalizeSourceRef({ kind: 'source', id: 'abc', version: '' })).toThrow('SourceRef.version');
  });

  it('freezes the 10k attachment cardinality and the exact normative schema bytes', () => {
    expect(MAX_CHAT_TURN_ATTACHMENTS).toBe(10_000);
    const hashes: Record<string, string> = {
      'chat-turn.v1.schema.json': 'e45e3e1cf04c9178b3c0c3b80a29ca2f735e1d30d5c924430cb6baed5934f75b',
      'harness-control.v1.schema.json': '5d4a6f2b02eb38769803da7becadd4cd79031547121b2539ca6aa2720914188d',
      'object-manifest.v1.schema.json': '733b1641cc310fe69e03727be159f58eb64361712190b1ed0ab29a7e8546c9ae',
    };
    for (const [file, expected] of Object.entries(hashes)) {
      expect(createHash('sha256').update(readFileSync(path.join(CONTRACT_SCHEMAS_DIR, file))).digest('hex')).toBe(expected);
    }
  });
});
