/**
 * CH-06 — canonical room↔channel bindings + outbox access for the listener.
 *
 * Frank OWNS the binding (§ChannelPort contract). This store is the
 * control-plane source of truth; the channels-listener reads it (via the
 * Domain API) and mirrors live bindings into its own durable StateStore. A
 * revoked binding routes nothing.
 *
 * The outbox access here is READ + ACK only: the listener polls pending
 * workbench/work state-change events and acks them once pushed. It never
 * writes canonical state through this path (§3.1).
 */

import { sql } from 'drizzle-orm';

import { newId } from '@frank/adapter-postgres';
import type { FrankDatabase } from '@frank/adapter-postgres';

export interface RoomChannelBindingRecord {
  id: string;
  cellId: string;
  roomId: string;
  platform: string;
  platformConversationId: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

type BindingRow = {
  id: string;
  cell_id: string;
  room_id: string;
  platform: string;
  platform_conversation_id: string;
  revoked_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toRecord(row: BindingRow): RoomChannelBindingRecord {
  return {
    id: row.id,
    cellId: row.cell_id,
    roomId: row.room_id,
    platform: row.platform,
    platformConversationId: row.platform_conversation_id,
    revokedAt: row.revoked_at === null ? null : asDate(row.revoked_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

const BINDING_COLUMNS = sql`id, cell_id, room_id, platform, platform_conversation_id, revoked_at, created_at, updated_at`;

/** A pending outbox event for the listener to push. */
export interface OutboxEventRecord {
  id: string;
  sequence: number;
  type: string;
  source: string;
  subject: string | null;
  cellId: string;
  aggregateKind: string;
  aggregateId: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

type OutboxRow = {
  id: string;
  sequence: number;
  type: string;
  source: string;
  subject: string | null;
  cellid: string;
  aggregate_kind: string;
  aggregate_id: string;
  data: Record<string, unknown>;
  created_at: Date | string;
};

function toOutboxRecord(row: OutboxRow): OutboxEventRecord {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    type: row.type,
    source: row.source,
    subject: row.subject,
    cellId: row.cellid,
    aggregateKind: row.aggregate_kind,
    aggregateId: row.aggregate_id,
    data: row.data,
    createdAt: asDate(row.created_at),
  };
}

export class ChannelPushStore {
  constructor(private readonly db: FrankDatabase) {}

  /* -------------------------------------------------------------- bindings --- */

  /**
   * Idempotently bind a room to a platform conversation. One live binding per
   * (cell, room, platform): re-binding replaces the conversation and clears a
   * prior revocation. Returns the resulting record.
   */
  async bind(
    cellId: string,
    roomId: string,
    platform: string,
    platformConversationId: string,
    by: string,
    now: Date,
  ): Promise<RoomChannelBindingRecord> {
    const id = newId();
    const rows = await this.db.execute<BindingRow>(sql`
      insert into "frank_domain"."room_channel_binding"
        (id, cell_id, room_id, platform, platform_conversation_id,
         created_at, updated_at, created_by, updated_by)
      values (${id}, ${cellId}, ${roomId}, ${platform}, ${platformConversationId},
              ${now}, ${now}, ${by}, ${by})
      on conflict (cell_id, room_id, platform) do update
        set platform_conversation_id = excluded.platform_conversation_id,
            revoked_at = null,
            updated_at = ${now},
            updated_by = ${by}
      returning ${BINDING_COLUMNS}, created_by, updated_by
    `);
    const row = rows.rows[0];
    if (row === undefined) throw new Error('bind returned no row');
    return toRecord(row);
  }

  /** List a room's bindings (including revoked, so the UI can show state). */
  async listByRoom(cellId: string, roomId: string): Promise<RoomChannelBindingRecord[]> {
    const rows = await this.db.execute<BindingRow>(sql`
      select ${BINDING_COLUMNS} from "frank_domain"."room_channel_binding"
      where cell_id = ${cellId} and room_id = ${roomId}
      order by created_at
    `);
    return rows.rows.map(toRecord);
  }

  /** List every LIVE (unrevoked) binding — what the listener mirrors. */
  async listLive(cellId: string): Promise<RoomChannelBindingRecord[]> {
    const rows = await this.db.execute<BindingRow>(sql`
      select ${BINDING_COLUMNS} from "frank_domain"."room_channel_binding"
      where cell_id = ${cellId} and revoked_at is null
      order by created_at
    `);
    return rows.rows.map(toRecord);
  }

  /** Get one binding. */
  async get(cellId: string, id: string): Promise<RoomChannelBindingRecord | null> {
    const rows = await this.db.execute<BindingRow>(sql`
      select ${BINDING_COLUMNS} from "frank_domain"."room_channel_binding"
      where cell_id = ${cellId} and id = ${id}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /** Revoke a binding (soft delete). Revoked bindings route nothing. */
  async revoke(cellId: string, id: string, by: string, now: Date): Promise<RoomChannelBindingRecord | null> {
    const rows = await this.db.execute<BindingRow>(sql`
      update "frank_domain"."room_channel_binding"
      set revoked_at = ${now}, updated_at = ${now}, updated_by = ${by}
      where cell_id = ${cellId} and id = ${id} and revoked_at is null
      returning ${BINDING_COLUMNS}
    `);
    const row = rows.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  /* --------------------------------------------------------------- outbox --- */

  /**
   * Poll pending outbox events after a sequence cursor, oldest first. The
   * listener pushes these to the platform and acks them. `types` filters to
   * the state-change events the listener cares about (frame discipline — it
   * does NOT consume every event, §3.4/CH-06).
   */
  async pollOutbox(
    cellId: string,
    afterSequence: number,
    limit: number,
    types: readonly string[],
  ): Promise<OutboxEventRecord[]> {
    const rows = await this.db.execute<OutboxRow>(sql`
      select id, sequence, type, source, subject, cellid, aggregate_kind, aggregate_id, data, created_at
      from "frank_domain"."outbox_event"
      where cellid = ${cellId}
        and sequence > ${afterSequence}
        and status = 'pending'
        and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
      order by sequence
      limit ${limit}
    `);
    return rows.rows.map(toOutboxRecord);
  }

  /**
   * Ack published events (mark published). Idempotent: re-acking is a no-op.
   * The listener calls this after a successful push.
   */
  async ackOutbox(ids: readonly string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(sql`
      update "frank_domain"."outbox_event"
      set status = 'published', published_at = ${now}
      where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        and status = 'pending'
    `);
  }

  /**
   * CH-07 — record a delivery failure and bump the attempt count. The event
   * stays `pending` so the next poll retries it (delivery retry). Returns the
   * new attempt count per id so the caller can dead-letter when a budget is
   * exhausted.
   */
  async markDeliveryFailure(
    ids: readonly string[],
    error: string,
    now: Date,
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(sql`
      update "frank_domain"."outbox_event"
      set attempts = attempts + 1, last_error = ${error}, available_at = ${now}
      where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        and status = 'pending'
    `);
  }

  /**
   * CH-07 — dead-letter events that exhausted their retry budget. Marks them
   * `quarantined` so polling never returns them again; the row (with
   * last_error) stays as the audit record. Idempotent.
   */
  async quarantineOutbox(ids: readonly string[], error: string, now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(sql`
      update "frank_domain"."outbox_event"
      set status = 'quarantined', quarantined_at = ${now}, last_error = ${error}
      where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        and status = 'pending'
    `);
  }
}
