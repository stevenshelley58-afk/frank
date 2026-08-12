import type { FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

/**
 * A drizzle `PgTransaction` inherits `.transaction()` from `PgDatabase` — it is
 * how savepoints are opened. So `typeof db.transaction === 'function'` is true
 * for BOTH a pool handle and an already-open transaction, and using it as the
 * "do I need to open a transaction?" test makes this function recurse forever
 * against a transaction argument, emitting one savepoint per level until the
 * connection dies. The turn then sits in `queued` with no error anywhere,
 * because every caller dispatches this work with a floating promise.
 *
 * `rollback()` exists only on `PgTransaction`, so it is the discriminator that
 * actually separates the two cases.
 */
type MaybeTransactional = Pick<FrankDatabase, 'execute'> &
  Partial<Pick<FrankDatabase, 'transaction'>> & { readonly rollback?: unknown };

function isOpenTransaction(db: MaybeTransactional): boolean {
  return typeof db.rollback === 'function';
}

/** Serialize cursor allocation on the parent turn row, including across cancel/runner races. */
export async function appendChatTurnEvent(
  db: MaybeTransactional,
  turn: { id: string; cell_id: string },
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!isOpenTransaction(db) && typeof db.transaction === 'function') {
    await db.transaction(async (tx) => appendChatTurnEvent(tx as unknown as MaybeTransactional, turn, kind, payload));
    return;
  }
  await db.execute(sql`select id from frank_domain.chat_turn where id=${turn.id}::uuid and cell_id=${turn.cell_id} for update`);
  await db.execute(sql`insert into frank_domain.chat_turn_event(turn_id,cell_id,cursor,kind,payload)
    select ${turn.id}::uuid,${turn.cell_id},coalesce(max(cursor)+1,0),${kind},${JSON.stringify(payload)}::jsonb
    from frank_domain.chat_turn_event where turn_id=${turn.id}::uuid`);
}
