/** SQL-only persistence seam: PostgreSQL is canonical; cache is never authoritative. */
import { sql } from 'drizzle-orm';
import type { FrankDatabase } from '@frank/adapter-postgres';
import type { TurnEvent } from '@frank/contracts';

export class HarnessControlStore {
  constructor(private readonly db: FrankDatabase) {}
  async appendEvent(cellId:string, event:TurnEvent):Promise<void> {
    await this.db.execute(sql`INSERT INTO frank_domain.chat_turn_event(turn_id,cell_id,cursor,kind,payload,created_at) VALUES(${event.turn_id},${cellId},${event.cursor},${event.kind},${JSON.stringify(event.payload)}::jsonb,${event.occurred_at})`);
  }
  async eventsAfter(cellId:string, turnId:string, cursor:number):Promise<unknown[]> {
    const result=await this.db.execute(sql`SELECT cursor,kind,payload,created_at FROM frank_domain.chat_turn_event WHERE cell_id=${cellId} AND turn_id=${turnId} AND cursor>${cursor} ORDER BY cursor ASC`);
    return result.rows;
  }
  async cancelTurn(cellId:string, turnId:string):Promise<boolean> {
    const result=await this.db.execute(sql`UPDATE frank_domain.chat_turn SET state='cancelled',cancelled_at=now(),updated_at=now() WHERE id=${turnId} AND cell_id=${cellId} AND state NOT IN ('completed','failed','cancelled') RETURNING id`);
    return result.rows.length===1;
  }
}
