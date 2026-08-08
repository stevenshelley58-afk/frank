/**
 * StagedWriteService — FS-03 staged shared writes (master plan §8G FS-03,
 * §3.2 filesystem fence).
 *
 * ## The rule
 *
 * A room folder binding with `mount_mode = 'staged'` is never bind-mounted
 * into a workbench (WB-03 provisioner): the shared source is COPIED into the
 * run's scratch volume and the run edits only the copy. Nothing the run does
 * can reach the shared source directly — there is no mount path to it.
 *
 * When the run wants its edits to LAND in the shared source, the control
 * plane takes over:
 *
 *   1. {@link proposeStagedWrite} records the proposal (`staged_write` row,
 *      migration 0008, state `pending`) and files a NORMAL decision work
 *      item through the HITL-01 seam (ADR-022 approval, state `waiting`) —
 *      indistinguishable in the API from any other decision — pausing the
 *      workbench.
 *   2. Resolution arrives through the NORMAL command envelope on that
 *      decision item. On `ready`, {@link landStagedWrite} performs the
 *      CONTROLLED copy (staged copy -> shared source) OUTSIDE the harness and
 *      records the landing: state `landed`, audit entry (FRANK-§11.5), copy
 *      attributed to the resolving actor. On `cancel`, {@link denyStagedWrite}
 *      marks it `denied` and copies nothing.
 *
 * A landing that skips the decision is impossible through this service:
 * {@link landStagedWrite} reads the decision work item's state from Postgres
 * and refuses unless it is `ready`. That check — not the caller's honesty —
 * is what makes "direct shared write" fail (tested).
 *
 * ## The copy seam
 *
 * The physical copy goes through {@link StagedCopyLand}, mirroring the
 * provisioner's {@link DockerCli} seam: the production control plane copies
 * on the VPS where the shared source lives (FS-04 may swap in an ssh-based
 * lander); tests use the real {@link FsStagedCopyLand} on temp directories,
 * which is what lets the integration suite assert actual bytes landed.
 */

import { sql } from 'drizzle-orm';

import { AuditRepository, newId, schema } from '@frank/adapter-postgres';
import type { FrankDatabase, FrankTransaction } from '@frank/adapter-postgres';

import { RoomFolderBindingStore } from './folder-binding-store.js';
import { WorkbenchDecisionService } from './decision.js';
import { WorkbenchNotFoundError } from './decision.js';
import { WorkbenchStore } from './store.js';
import type { SettleWriteBackLandingCommand } from './write-back.js';
import type { WriteBackService } from './write-back.js';

type ActorKind = schema.ActorKind;

/* ------------------------------------------------------------ copy seam --- */

/** Performs the physical staged copy -> shared source transfer. */
export interface StagedCopyLand {
  copy(sourcePath: string, targetPath: string): Promise<void>;
}

/**
 * Real filesystem copy (recursive — a staged folder lands as a folder).
 * Runs wherever the control plane runs; the VPS hosts the shared source
 * (FS-01 layout `/srv/frank/sync/<room>/<folder>`).
 */
export class FsStagedCopyLand implements StagedCopyLand {
  async copy(sourcePath: string, targetPath: string): Promise<void> {
    const { cp } = await import('node:fs/promises');
    await cp(sourcePath, targetPath, { recursive: true });
  }
}

/* --------------------------------------------------------------- errors --- */

export class StagedWriteNotFoundError extends Error {
  constructor(readonly decisionWorkItemId: string) {
    super(`no staged write is linked to decision work item ${decisionWorkItemId}`);
  }
}

/** Landing was attempted without an approving (`ready`) decision. */
export class StagedWriteNotApprovedError extends Error {
  constructor(readonly stagedWriteId: string, readonly decisionState: string) {
    super(
      `staged write ${stagedWriteId} cannot land: decision work item is "${decisionState}", not "ready"`,
    );
  }
}

/** The proposal does not match the room's declarations (unbound folder, wrong mode). */
export class StagedWriteRejectedError extends Error {
  constructor(readonly workbenchId: string, readonly reason: string) {
    super(`staged write rejected for workbench ${workbenchId}: ${reason}`);
  }
}

/* ---------------------------------------------------------------- types --- */

export interface ProposeStagedWriteCommand {
  readonly cellId: string;
  readonly workbenchId: string;
  /** The room the target folder is bound to — must equal the workbench's room. */
  readonly roomId: string;
  /** The synced folder's id/name (FS-01) being written back. */
  readonly folderSource: string;
  /** Where the run's approved copy lives (VPS path). */
  readonly stagedCopyPath: string;
  /** The proposer's note for the approver. */
  readonly note?: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface ProposeStagedWriteOutcome {
  readonly stagedWriteId: string;
  readonly decisionWorkItemId: string;
  readonly workbenchState: 'waiting';
}

export interface SettleStagedWriteCommand {
  readonly cellId: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface StagedWriteRecord {
  readonly id: string;
  readonly cellId: string;
  readonly workbenchId: string;
  readonly roomId: string;
  readonly folderSource: string;
  readonly bindingId: string;
  readonly stagedCopyPath: string;
  readonly targetPath: string;
  readonly note: string | null;
  readonly decisionWorkItemId: string;
  readonly state: 'pending' | 'landed' | 'denied';
  readonly proposedAt: Date;
  readonly proposedBy: string;
  readonly landedAt: Date | null;
  readonly landedBy: string | null;
}

type StagedWriteRow = {
  id: string;
  cell_id: string;
  workbench_id: string;
  room_id: string;
  folder_source: string;
  binding_id: string;
  staged_copy_path: string;
  target_path: string;
  note: string | null;
  decision_work_item_id: string;
  state: 'pending' | 'landed' | 'denied';
  proposed_at: Date | string;
  proposed_by: string;
  landed_at: Date | null;
  landed_by: string | null;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRecord(row: StagedWriteRow): StagedWriteRecord {
  return {
    id: row.id,
    cellId: row.cell_id,
    workbenchId: row.workbench_id,
    roomId: row.room_id,
    folderSource: row.folder_source,
    bindingId: row.binding_id,
    stagedCopyPath: row.staged_copy_path,
    targetPath: row.target_path,
    note: row.note,
    decisionWorkItemId: row.decision_work_item_id,
    state: row.state,
    proposedAt: asDate(row.proposed_at),
    proposedBy: row.proposed_by,
    landedAt: row.landed_at === null ? null : asDate(row.landed_at),
    landedBy: row.landed_by,
  };
}

/* -------------------------------------------------------------- service --- */

export class StagedWriteService {
  readonly #db: FrankDatabase;
  readonly #store: WorkbenchStore;
  readonly #bindings: RoomFolderBindingStore;
  readonly #decisions: WorkbenchDecisionService;
  readonly #audit = new AuditRepository();
  readonly #copier: StagedCopyLand;
  /** FS-04: write-back/offline behavior; absent => no write-back recording. */
  readonly #writeBack: WriteBackService | null;

  constructor(
    db: FrankDatabase,
    decisions: WorkbenchDecisionService,
    copier: StagedCopyLand = new FsStagedCopyLand(),
    writeBack: WriteBackService | null = null,
  ) {
    this.#db = db;
    this.#store = new WorkbenchStore(db);
    this.#bindings = new RoomFolderBindingStore(db);
    this.#decisions = decisions;
    this.#copier = copier;
    this.#writeBack = writeBack;
  }

  get store(): WorkbenchStore {
    return this.#store;
  }

  /**
   * FS-03 propose: record the staged-write proposal and file the ADR-022
   * decision that approves it, in ONE transaction (FRANK-§11.5: the row, the
   * decision work item, the pause, the audit commit together or not at all).
   * The workbench pauses (`waiting`) exactly like any HITL-01 decision.
   */
  async proposeStagedWrite(
    command: ProposeStagedWriteCommand,
  ): Promise<ProposeStagedWriteOutcome> {
    const record = await this.#store.getWorkbench(command.cellId, command.workbenchId);
    if (record === null) throw new WorkbenchNotFoundError(command.workbenchId);
    if (record.roomId === null || record.roomId !== command.roomId) {
      throw new StagedWriteRejectedError(
        record.id,
        `the workbench belongs to room "${record.roomId ?? '(none)'}", not "${command.roomId}"`,
      );
    }
    // Only a live run proposes write-back (same posture as HITL-01).
    if (record.state !== 'running' && record.state !== 'provisioning') {
      throw new StagedWriteRejectedError(
        record.id,
        `cannot propose a staged write while the workbench is "${record.state}"`,
      );
    }

    // The folder must be bound to the room — the declaration FS-02 recorded.
    const bindings = await this.#bindings.listByRoom(command.cellId, command.roomId);
    const binding = bindings.find((b) => b.folderSource === command.folderSource);
    if (binding === undefined) {
      throw new StagedWriteRejectedError(
        record.id,
        `folder "${command.folderSource}" is not bound to room "${command.roomId}" (FS-02)`,
      );
    }
    if (binding.mountMode !== 'staged') {
      throw new StagedWriteRejectedError(
        record.id,
        `folder "${command.folderSource}" is mounted "${binding.mountMode}"; only staged bindings write back through approval`,
      );
    }
    // And the workbench must actually hold the staged mount (task def named
    // the bound folder — §3.2: both sides must agree). A mount can reference
    // the folder either by its resolved server path (the production compose
    // path resolves sources to the binding's server_path) or by the folder
    // source name (when the task def names the folder directly). Accept either.
    const held = (record.taskDef.mounts ?? []).some(
      (mount) =>
        mount.mode === 'staged' &&
        (mount.source === binding.serverPath || mount.source === binding.folderSource),
    );
    if (!held) {
      throw new StagedWriteRejectedError(
        record.id,
        `the workbench does not hold a staged mount for "${command.folderSource}"`,
      );
    }

    const stagedWriteId = newId();
    const actorRef = `${command.actor.kind}/${command.actor.id}`;
    const question =
      `Approve staged write to shared folder "${command.folderSource}" ` +
      `(room "${command.roomId}")?`;

    const decisionWorkItemId = await this.#db.transaction(async (tx) => {
      // 1) The decision — a NORMAL ADR-022 approval in `waiting` (HITL-01
      //    seam, in the caller's transaction so row + decision commit as one).
      const decisionId = await this.#decisions.requestDecisionInTransaction(
        tx,
        {
          cellId: command.cellId,
          workbenchId: record.id,
          question,
          ...(command.note === undefined ? {} : { whyNow: command.note }),
          nextSafeAction: 'Approve to copy the staged result into the shared source.',
          evidence: [
            `staged-copy: ${command.stagedCopyPath}`,
            `shared-source: ${binding.serverPath}`,
          ],
          actor: command.actor,
          correlationId: command.correlationId,
          now: command.now,
        },
        record,
      );

      // 2) The filesystem fact the decision approves (migration 0008).
      await tx.execute(sql`
        insert into "frank_domain"."staged_write"
          (id, cell_id, workbench_id, room_id, folder_source, binding_id,
           staged_copy_path, target_path, note, decision_work_item_id,
           state, proposed_at, proposed_by)
        values (${stagedWriteId}, ${command.cellId}, ${record.id}, ${command.roomId},
                ${command.folderSource}, ${binding.id},
                ${command.stagedCopyPath}, ${binding.serverPath},
                ${command.note ?? null}, ${decisionId},
                'pending', ${command.now}, ${actorRef})
      `);

      // 3) Audit the proposal (§3.1).
      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'staged_write.proposed',
        targetKind: 'staged_write',
        targetId: stagedWriteId,
        correlationId: command.correlationId,
        dataClass: 'private',
        changeRedacted: {
          fields: ['staged_copy_path', 'target_path'],
          state: 'pending',
          folderSource: command.folderSource,
          decisionWorkItemId: decisionId,
        },
      });

      return decisionId;
    });

    return { stagedWriteId, decisionWorkItemId, workbenchState: 'waiting' };
  }

  /**
   * One staged write by its decision work item (the resolution path), or
   * null when the decision is not a staged-write approval.
   */
  async getByDecisionWorkItem(
    cellId: string,
    decisionWorkItemId: string,
  ): Promise<StagedWriteRecord | null> {
    const rows = await this.#db.execute<StagedWriteRow>(sql`
      select id, cell_id, workbench_id, room_id, folder_source, binding_id,
             staged_copy_path, target_path, note, decision_work_item_id,
             state, proposed_at, proposed_by, landed_at, landed_by
      from "frank_domain"."staged_write"
      where cell_id = ${cellId} and decision_work_item_id = ${decisionWorkItemId}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /**
   * FS-03 land: called when the decision resolves `ready`. Verifies the
   * approval from the decision work item's OWN state (never trusts the
   * caller), performs the controlled copy outside the harness, and records
   * the landing with a full audit entry. Idempotent: an already-settled
   * staged write is a no-op.
   *
   * FS-04: after the controlled copy lands on the server copy, the landing
   * transaction ALSO records the write-back outcome in the `pending_sync`
   * queue when the binding opted into write-back — an offline PC produces a
   * `pending` queue entry instead of failing the workbench, and a changed
   * device copy is recorded as a `conflict`, never auto-overwritten. The
   * workbench resumed before landing (HITL-02) and stays unaffected here:
   * nothing the queue recording does can fail the run.
   */
  async landStagedWrite(
    decisionWorkItemId: string,
    command: SettleStagedWriteCommand,
  ): Promise<void> {
    const write = await this.getByDecisionWorkItem(command.cellId, decisionWorkItemId);
    if (write === null) return; // not a staged-write decision; nothing to do
    if (write.state !== 'pending') return; // already settled — no-op

    // The fence: landing requires the decision work item to be `ready`.
    // Reading the state back from Postgres means an unapproved proposal can
    // never reach the shared source through this service.
    const decisionState = await this.#decisionState(decisionWorkItemId, command.cellId);
    if (decisionState !== 'ready') {
      throw new StagedWriteNotApprovedError(write.id, decisionState);
    }

    // The controlled copy — OUTSIDE the harness, before the durable marking.
    // A failure here throws: the row stays `pending`, the audit chain shows
    // no landing, and the command envelope surfaces the error (same
    // "never mask a half-landed write" posture as HITL-02 resolution).
    await this.#copier.copy(write.stagedCopyPath, write.targetPath);

    const actorRef = `${command.actor.kind}/${command.actor.id}`;
    await this.#db.transaction(async (tx) => {
      await this.#settle(tx, write.id, 'landed', command.now, actorRef);
      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'staged_write.landed',
        targetKind: 'staged_write',
        targetId: write.id,
        correlationId: command.correlationId,
        causationId: decisionWorkItemId,
        dataClass: 'private',
        changeRedacted: {
          fields: ['staged_copy_path', 'target_path'],
          state: 'landed',
          folderSource: write.folderSource,
          workbenchId: write.workbenchId,
        },
      });

      // FS-04: record what the landing means for the destination device —
      // inside the SAME transaction (FRANK-§11.5), so "landed" and "waiting
      // to sync / conflict" are one durable fact. Returns null when the
      // binding did not opt into write-back. A failure to probe degrades to
      // the honest offline record; nothing here throws for the device being
      // unreachable — that is the whole point of FS-04.
      if (this.#writeBack !== null) {
        const landing: SettleWriteBackLandingCommand = {
          cellId: command.cellId,
          workbenchId: write.workbenchId,
          roomId: write.roomId,
          folderSource: write.folderSource,
          bindingId: write.bindingId,
          stagedWriteId: write.id,
          sourcePath: write.stagedCopyPath,
          targetPath: write.targetPath,
          actor: command.actor,
          correlationId: command.correlationId,
          now: command.now,
        };
        await this.#writeBack.settleLanding(landing, tx);
      }
    });
  }

  /**
   * FS-03 deny: called when the decision resolves `cancel`. Copies nothing;
   * marks the proposal `denied` so the record is honest and complete.
   * Idempotent: an already-settled staged write is a no-op.
   */
  async denyStagedWrite(
    decisionWorkItemId: string,
    command: SettleStagedWriteCommand,
  ): Promise<void> {
    const write = await this.getByDecisionWorkItem(command.cellId, decisionWorkItemId);
    if (write === null) return;
    if (write.state !== 'pending') return;

    const actorRef = `${command.actor.kind}/${command.actor.id}`;
    await this.#db.transaction(async (tx) => {
      await this.#settle(tx, write.id, 'denied', command.now, actorRef);
      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'staged_write.denied',
        targetKind: 'staged_write',
        targetId: write.id,
        correlationId: command.correlationId,
        causationId: decisionWorkItemId,
        dataClass: 'private',
        changeRedacted: {
          fields: ['staged_copy_path', 'target_path'],
          state: 'denied',
          folderSource: write.folderSource,
          workbenchId: write.workbenchId,
        },
      });
    });
  }

  /* ------------------------------------------------------------- helpers --- */

  async #decisionState(decisionWorkItemId: string, cellId: string): Promise<string> {
    const rows = await this.#db.execute<{ state: string }>(sql`
      select state from "frank_domain"."work_item"
      where id = ${decisionWorkItemId} and cell_id = ${cellId}
    `);
    return rows.rows[0]?.state ?? 'unknown';
  }

  async #settle(
    tx: FrankTransaction,
    stagedWriteId: string,
    state: 'landed' | 'denied',
    now: Date,
    by: string,
  ): Promise<void> {
    await tx.execute(sql`
      update "frank_domain"."staged_write" set
        state = ${state},
        landed_at = ${now},
        landed_by = ${by}
      where id = ${stagedWriteId} and state = 'pending'
    `);
  }
}
