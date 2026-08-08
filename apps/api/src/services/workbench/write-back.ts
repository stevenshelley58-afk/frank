/**
 * WriteBackService — FS-04 write-back and offline behavior (master plan §8G
 * FS-04).
 *
 * ## The rule
 *
 * The plan's clarification is the contract here: "A workbench can continue
 * with the server copy while the laptop is closed. Results sync back when
 * the PC reconnects. The plan must not claim live write-back to an offline
 * device."
 *
 * Concretely, when an APPROVED staged write (FS-03) lands into a shared
 * folder whose binding opted into write-back ({@link isWriteBackAllowed}),
 * the landing on the VPS always succeeds — that is FS-03's controlled copy.
 * What happens to the destination PC is recorded honestly in the
 * `pending_sync` queue (migration 0009) instead of being claimed or failed:
 *
 *   * PC OFFLINE (the normal "laptop closed" case): a `pending_sync` row is
 *     recorded (`state = 'pending'`, `reason = 'device-offline'`) and the
 *     workbench completes NORMALLY. Nothing failed — the result is waiting
 *     to sync. FS-01/Syncthing drains the queue when the PC reconnects;
 *     {@link markSynced} is that seam.
 *   * CONFLICT: if the write-back would overwrite a file that changed on the
 *     device, the row is recorded `state = 'conflict'` — never auto-synced,
 *     never destructively overridden. {@link markSynced} refuses conflict
 *     rows; a human (or a future conflict-resolution flow) must settle them.
 *   * PC ONLINE: the row is still recorded (`reason = 'device-online'`)
 *     because the physical transport is FS-01/Syncthing, not this API; the
 *     row is the honest work item the syncer drains.
 *
 * ## The probe seam (FS-01 owns device presence)
 *
 * Whether the destination PC is offline, online, or holding a changed copy
 * can only be known by the sync layer (FS-01/Syncthing). That layer is not
 * built yet, so this service asks a {@link DeviceSyncProbe}. The production
 * default is {@link AssumeOfflineDeviceProbe}: it reports offline, because
 * until FS-01 provides real presence the honest answer is "we do not know
 * that the device received anything" — never a claim of live write-back.
 * Tests (and, later, the Syncthing integration) inject a real probe.
 */

import { sql } from 'drizzle-orm';

import { AuditRepository, newId } from '@frank/adapter-postgres';
import type { FrankDatabase, FrankTransaction, schema } from '@frank/adapter-postgres';

import type { RoomFolderBindingRecord } from './folder-binding-store.js';
import { RoomFolderBindingStore } from './folder-binding-store.js';

type ActorKind = schema.ActorKind;

/* --------------------------------------------------------------- errors --- */

export class PendingSyncNotFoundError extends Error {
  constructor(readonly pendingSyncId: string) {
    super(`no pending_sync ${pendingSyncId} exists in this cell`);
  }
}

/**
 * markSynced was attempted on a row recorded as a conflict. FS-04: conflicts
 * are recorded honestly and never auto-overwritten — draining one requires
 * explicit human resolution, not a sync ack.
 */
export class PendingSyncConflictError extends Error {
  constructor(readonly pendingSyncId: string, readonly detail: string | null) {
    super(
      `pending_sync ${pendingSyncId} is a recorded conflict and will not be auto-synced (FS-04: no destructive override)${detail === null ? '' : `: ${detail}`}`,
    );
  }
}

/* ---------------------------------------------------------------- types --- */

/**
 * What the sync layer knows about the destination device for one binding.
 * FS-01/Syncthing supplies the real implementation; until then the honest
 * default is "offline" (see {@link AssumeOfflineDeviceProbe}).
 */
export type DeviceSyncStatus =
  | { readonly kind: 'offline'; readonly detail?: string }
  | { readonly kind: 'online'; readonly detail?: string }
  | { readonly kind: 'conflict'; readonly detail: string };

export interface DeviceSyncProbe {
  probe(binding: RoomFolderBindingRecord): Promise<DeviceSyncStatus>;
}

/**
 * The honest default until FS-01 exists: without a device-presence layer we
 * never claim the device received a write. Every landing queues as
 * device-offline and waits for the real syncer.
 */
export class AssumeOfflineDeviceProbe implements DeviceSyncProbe {
  async probe(_binding: RoomFolderBindingRecord): Promise<DeviceSyncStatus> {
    return {
      kind: 'offline',
      detail:
        'no device-presence layer wired yet (FS-01/Syncthing owns it); treated as offline — never claim live write-back',
    };
  }
}

export type PendingSyncState = 'pending' | 'synced' | 'conflict';

export type PendingSyncReason =
  | 'device-offline'
  | 'device-online'
  | 'target-changed-on-device';

export interface PendingSyncRecord {
  readonly id: string;
  readonly cellId: string;
  readonly workbenchId: string;
  readonly roomId: string;
  readonly folderSource: string;
  readonly bindingId: string;
  readonly stagedWriteId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly state: PendingSyncState;
  readonly reason: PendingSyncReason;
  readonly detail: string | null;
  readonly proposedAt: Date;
  readonly proposedBy: string;
  readonly syncedAt: Date | null;
  readonly syncedBy: string | null;
}

export interface RecordPendingSyncCommand {
  readonly cellId: string;
  readonly workbenchId: string;
  readonly roomId: string;
  readonly folderSource: string;
  readonly bindingId: string;
  readonly stagedWriteId: string;
  /** The landed server copy the sync transfers FROM. */
  readonly sourcePath: string;
  /** The destination the device syncs TO (the binding's server path). */
  readonly targetPath: string;
  readonly state: PendingSyncState;
  readonly reason: PendingSyncReason;
  readonly detail?: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

/** The FS-03 landing hook input — plain fields, no cross-import of FS-03 types. */
export interface SettleWriteBackLandingCommand {
  readonly cellId: string;
  readonly workbenchId: string;
  readonly roomId: string;
  readonly folderSource: string;
  readonly bindingId: string;
  readonly stagedWriteId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

export interface MarkSyncedCommand {
  readonly cellId: string;
  readonly actor: { kind: ActorKind; id: string };
  readonly correlationId: string;
  readonly now: Date;
}

type PendingSyncRow = {
  id: string;
  cell_id: string;
  workbench_id: string;
  room_id: string;
  folder_source: string;
  binding_id: string;
  staged_write_id: string;
  source_path: string;
  target_path: string;
  state: PendingSyncState;
  reason: PendingSyncReason;
  detail: string | null;
  proposed_at: Date | string;
  proposed_by: string;
  synced_at: Date | string | null;
  synced_by: string | null;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toRecord(row: PendingSyncRow): PendingSyncRecord {
  return {
    id: row.id,
    cellId: row.cell_id,
    workbenchId: row.workbench_id,
    roomId: row.room_id,
    folderSource: row.folder_source,
    bindingId: row.binding_id,
    stagedWriteId: row.staged_write_id,
    sourcePath: row.source_path,
    targetPath: row.target_path,
    state: row.state,
    reason: row.reason,
    detail: row.detail,
    proposedAt: asDate(row.proposed_at),
    proposedBy: row.proposed_by,
    syncedAt: row.synced_at === null ? null : asDate(row.synced_at),
    syncedBy: row.synced_by,
  };
}

const PENDING_SYNC_SELECT = `
  select id, cell_id, workbench_id, room_id, folder_source, binding_id,
         staged_write_id, source_path, target_path, state, reason, detail,
         proposed_at, proposed_by, synced_at, synced_by
  from "frank_domain"."pending_sync"
`;

/* ------------------------------------------------------------ the gate ---- */

/**
 * FS-04: write-back is OPT-IN per folder. A binding allows write-back only
 * when the declaration says so (`write_back = true`) AND the declared sync
 * direction permits the server side writing toward the device:
 * `receive-only` means the workbench only consumes this folder, so nothing
 * may write back into it.
 */
export function isWriteBackAllowed(binding: RoomFolderBindingRecord): boolean {
  return binding.writeBack === true && binding.syncDirection !== 'receive-only';
}

/* -------------------------------------------------------------- service --- */

export class WriteBackService {
  readonly #db: FrankDatabase;
  readonly #bindings: RoomFolderBindingStore;
  readonly #audit = new AuditRepository();
  readonly #probe: DeviceSyncProbe;

  constructor(db: FrankDatabase, probe: DeviceSyncProbe = new AssumeOfflineDeviceProbe()) {
    this.#db = db;
    this.#bindings = new RoomFolderBindingStore(db);
    this.#probe = probe;
  }

  /** See the exported {@link isWriteBackAllowed} — the FS-04 opt-in gate. */
  isWriteBackAllowed(binding: RoomFolderBindingRecord): boolean {
    return isWriteBackAllowed(binding);
  }

  /**
   * FS-04 landing hook, called by FS-03's `landStagedWrite` AFTER the
   * controlled copy landed on the server copy, INSIDE the landing
   * transaction (FRANK-§11.5: the landing, the queue entry, and the audit
   * entries commit together or not at all). Decides the device outcome via
   * the probe seam and records it in the `pending_sync` queue — the
   * workbench itself already resumed before landing; nothing here may fail
   * it (a probe error degrades to "offline", the honest conservative
   * answer — never a claim of delivery).
   */
  async settleLanding(
    command: SettleWriteBackLandingCommand,
    tx: FrankTransaction,
  ): Promise<PendingSyncRecord | null> {
    const binding = await this.#bindings.get(command.cellId, command.bindingId);
    if (binding === null) return null; // unreachable while the FK restrict holds
    if (!isWriteBackAllowed(binding)) return null; // not opted in: nothing to sync back

    let status: DeviceSyncStatus;
    try {
      status = await this.#probe.probe(binding);
    } catch {
      status = {
        kind: 'offline',
        detail: 'device presence probe failed; treated as offline (FS-04: never claim live write-back)',
      };
    }

    const mapped =
      status.kind === 'conflict'
        ? {
            state: 'conflict' as const,
            reason: 'target-changed-on-device' as const,
            detail: status.detail,
          }
        : status.kind === 'online'
          ? {
              state: 'pending' as const,
              reason: 'device-online' as const,
              ...(status.detail === undefined ? {} : { detail: status.detail }),
            }
          : {
              state: 'pending' as const,
              reason: 'device-offline' as const,
              ...(status.detail === undefined ? {} : { detail: status.detail }),
            };

    const row = await this.recordPendingSyncInTransaction(tx, {
      cellId: command.cellId,
      workbenchId: command.workbenchId,
      roomId: command.roomId,
      folderSource: command.folderSource,
      bindingId: command.bindingId,
      stagedWriteId: command.stagedWriteId,
      sourcePath: command.sourcePath,
      targetPath: command.targetPath,
      state: mapped.state,
      reason: mapped.reason,
      ...('detail' in mapped ? { detail: mapped.detail } : {}),
      actor: command.actor,
      correlationId: command.correlationId,
      now: command.now,
    });
    return toRecord(row);
  }

  /**
   * Record (idempotently) that a landed, approved write-back is waiting for
   * the device — or that it conflicted. Opens its own transaction; callers
   * already inside one (the FS-03 landing hook) use
   * {@link recordPendingSyncInTransaction} instead. The unique index on
   * `staged_write_id` makes replays update the same row instead of minting a
   * second queue entry. Audited: the queue is part of the cell's chain.
   */
  async recordPendingSync(command: RecordPendingSyncCommand): Promise<PendingSyncRecord> {
    const row = await this.#db.transaction((tx) =>
      this.recordPendingSyncInTransaction(tx, command),
    );
    return toRecord(row);
  }

  /**
   * The transactional core of {@link recordPendingSync} — FRANK-§11.5: the
   * queue entry and its audit entry commit in the caller's transaction, so
   * the FS-03 landing and the FS-04 queue record are one durable fact.
   */
  async recordPendingSyncInTransaction(
    tx: FrankTransaction,
    command: RecordPendingSyncCommand,
  ): Promise<PendingSyncRow> {
    const pendingSyncId = newId();
    const actorRef = `${command.actor.kind}/${command.actor.id}`;

    const rows = await tx.execute<PendingSyncRow>(sql`
      insert into "frank_domain"."pending_sync"
        (id, cell_id, workbench_id, room_id, folder_source, binding_id,
         staged_write_id, source_path, target_path, state, reason, detail,
         proposed_at, proposed_by)
      values (${pendingSyncId}, ${command.cellId}, ${command.workbenchId}, ${command.roomId},
              ${command.folderSource}, ${command.bindingId},
              ${command.stagedWriteId}, ${command.sourcePath}, ${command.targetPath},
              ${command.state}, ${command.reason}, ${command.detail ?? null},
              ${command.now}, ${actorRef})
      on conflict ("staged_write_id") do update set
        "state" = excluded."state",
        "reason" = excluded."reason",
        "detail" = excluded."detail"
      returning id, cell_id, workbench_id, room_id, folder_source, binding_id,
                staged_write_id, source_path, target_path, state, reason, detail,
                proposed_at, proposed_by, synced_at, synced_by
    `);
    const recorded = rows.rows[0];
    if (recorded === undefined) {
      // Unreachable: RETURNING always yields the row; guard for narrowing.
      throw new Error('pending_sync upsert returned no row');
    }

    await this.#audit.append(tx, {
      cellId: command.cellId,
      occurredAt: command.now,
      actorKind: command.actor.kind,
      actorId: command.actor.id,
      action: command.state === 'conflict' ? 'write_back.conflict' : 'write_back.queued',
      targetKind: 'pending_sync',
      targetId: recorded.id,
      correlationId: command.correlationId,
      causationId: command.stagedWriteId,
      dataClass: 'private',
      changeRedacted: {
        fields: ['source_path', 'target_path'],
        state: command.state,
        reason: command.reason,
        folderSource: command.folderSource,
        workbenchId: command.workbenchId,
      },
    });

    return recorded;
  }

  /**
   * Drain one queue entry when the PC reconnects and the sync layer has
   * transferred the result (FS-01/Syncthing calls this; the placeholder seam
   * lives here until the real transport exists).
   *
   * Honesty rules: a `conflict` row is REFUSED ({@link PendingSyncConflictError})
   * — no destructive auto-override; an already-`synced` row is a no-op; an
   * unknown id throws {@link PendingSyncNotFoundError}.
   */
  async markSynced(
    cellId: string,
    pendingSyncId: string,
    command: MarkSyncedCommand,
  ): Promise<PendingSyncRecord> {
    const current = await this.get(cellId, pendingSyncId);
    if (current === null) throw new PendingSyncNotFoundError(pendingSyncId);
    if (current.state === 'conflict') {
      throw new PendingSyncConflictError(pendingSyncId, current.detail);
    }
    if (current.state === 'synced') return current; // idempotent replay

    const actorRef = `${command.actor.kind}/${command.actor.id}`;
    const row = await this.#db.transaction(async (tx) => {
      const rows = await tx.execute<PendingSyncRow>(sql`
        update "frank_domain"."pending_sync" set
          state = 'synced',
          synced_at = ${command.now},
          synced_by = ${actorRef}
        where id = ${pendingSyncId} and cell_id = ${cellId} and state = 'pending'
        returning id, cell_id, workbench_id, room_id, folder_source, binding_id,
                  staged_write_id, source_path, target_path, state, reason, detail,
                  proposed_at, proposed_by, synced_at, synced_by
      `);
      const updated = rows.rows[0];
      if (updated === undefined) {
        // A concurrent markSynced won the race: re-read and return it.
        return null;
      }

      await this.#audit.append(tx, {
        cellId: command.cellId,
        occurredAt: command.now,
        actorKind: command.actor.kind,
        actorId: command.actor.id,
        action: 'write_back.synced',
        targetKind: 'pending_sync',
        targetId: pendingSyncId,
        correlationId: command.correlationId,
        causationId: current.stagedWriteId,
        dataClass: 'private',
        changeRedacted: {
          fields: ['source_path', 'target_path'],
          state: 'synced',
          folderSource: current.folderSource,
          workbenchId: current.workbenchId,
        },
      });

      return updated;
    });

    return row === null ? ((await this.get(cellId, pendingSyncId)) as PendingSyncRecord) : toRecord(row);
  }

  /** One queue entry by id, scoped to the cell; null when absent. */
  async get(cellId: string, id: string): Promise<PendingSyncRecord | null> {
    const rows = await this.#db.execute<PendingSyncRow>(sql`
      ${sql.raw(PENDING_SYNC_SELECT)}
      where "cell_id" = ${cellId} and "id" = ${id}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /** The room's write-back queue, oldest first (GET /v1/rooms/:roomId/pending-syncs). */
  async listByRoom(cellId: string, roomId: string): Promise<PendingSyncRecord[]> {
    const rows = await this.#db.execute<PendingSyncRow>(sql`
      ${sql.raw(PENDING_SYNC_SELECT)}
      where "cell_id" = ${cellId} and "room_id" = ${roomId}
      order by "proposed_at" asc, "id" asc
    `);
    return rows.rows.map(toRecord);
  }
}
