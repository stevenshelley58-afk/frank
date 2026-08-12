import type { FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

/** Serialize cursor allocation on the parent turn row, including across cancel/runner races. */
export async function appendChatTurnEvent(
  db: Pick<FrankDatabase, 'execute'> & Partial<Pick<FrankDatabase, 'transaction'>>,
  turn: { id: string; cell_id: string },
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (typeof db.transaction === 'function') {
    await db.transaction(async (tx) => appendChatTurnEvent(tx, turn, kind, payload));
    return;
  }
  await db.execute(sql`select id from frank_domain.chat_turn where id=${turn.id}::uuid and cell_id=${turn.cell_id} for update`);
  await db.execute(sql`insert into frank_domain.chat_turn_event(turn_id,cell_id,cursor,kind,payload)
    select ${turn.id}::uuid,${turn.cell_id},coalesce(max(cursor)+1,0),${kind},${JSON.stringify(payload)}::jsonb
    from frank_domain.chat_turn_event where turn_id=${turn.id}::uuid`);
}
