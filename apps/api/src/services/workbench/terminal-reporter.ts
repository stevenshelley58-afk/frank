/** Keep the canonical WorkItem lifecycle in lockstep with a workbench run. */

import { sql } from 'drizzle-orm';

import { AuditRepository, OutboxRepository, WorkItemRepository } from '@frank/adapter-postgres';
import type { FrankDatabase, FrankTransaction } from '@frank/adapter-postgres';

import type { TerminalReporter } from './runner.js';
import type { WorkbenchRecord } from './types.js';

type TerminalOutcome = Parameters<TerminalReporter['reportTerminal']>[1];

export class WorkbenchTerminalReporter implements TerminalReporter {
  readonly #db: FrankDatabase;
  readonly #work = new WorkItemRepository(new AuditRepository(), new OutboxRepository());
  readonly #reporterId: string;
  readonly #now: () => Date;

  constructor(db: FrankDatabase, reporterId: string, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#reporterId = reporterId;
    this.#now = now;
  }

  async reportRunning(record: WorkbenchRecord): Promise<void> {
    await this.#db.transaction(async (tx) => {
      const current = await readState(tx, record);
      if (current === null || current.state === 'active') return;
      if (isTerminal(current.state)) return;
      await this.#transitionToActive(tx, record, current.state, current.version);
    });
  }

  async reportTerminal(record: WorkbenchRecord, outcome: TerminalOutcome): Promise<void> {
    await this.#db.transaction(async (tx) => {
      let current = await readState(tx, record);
      if (current === null || isTerminal(current.state)) return;

      if (current.state !== 'active' && current.state !== 'reviewing') {
        const active = await this.#transitionToActive(
          tx,
          record,
          current.state,
          current.version,
        );
        current = { state: 'active', version: active.version };
      }

      const toState =
        outcome.kind === 'done'
          ? 'done'
          : outcome.kind === 'cancelled'
            ? 'cancelled'
            : 'failed';
      const reason =
        outcome.kind === 'done'
          ? 'Workbench completed with a durable receipt.'
          : outcome.kind === 'cancelled'
            ? `Workbench stopped: ${outcome.reason}`
            : `Workbench failed: ${outcome.error}`;
      await this.#work.transition(tx, {
        workItemId: record.workItemId,
        cellId: record.cellId,
        expectedVersion: current.version,
        toState,
        actor: { kind: 'service', id: this.#reporterId },
        reason,
        correlationId: `workbench/${record.id}`,
        now: this.#now(),
      });
    });
  }

  async #transitionToActive(
    tx: FrankTransaction,
    record: WorkbenchRecord,
    state: string,
    version: number,
  ): Promise<{ version: number }> {
    let currentState = state;
    let currentVersion = version;
    if (currentState === 'inbox' || currentState === 'planned') {
      const ready = await this.#work.transition(tx, {
        workItemId: record.workItemId,
        cellId: record.cellId,
        expectedVersion: currentVersion,
        toState: 'ready',
        actor: { kind: 'service', id: this.#reporterId },
        reason: 'Workbench accepted by the runner.',
        correlationId: `workbench/${record.id}`,
        now: this.#now(),
      });
      currentState = ready.toState;
      currentVersion = ready.version;
    }
    const active = await this.#work.transition(tx, {
      workItemId: record.workItemId,
      cellId: record.cellId,
      expectedVersion: currentVersion,
      toState: 'active',
      actor: { kind: 'service', id: this.#reporterId },
      reason: `Workbench execution started from ${currentState}.`,
      correlationId: `workbench/${record.id}`,
      now: this.#now(),
    });
    return { version: active.version };
  }
}

function isTerminal(state: string): boolean {
  return state === 'done' || state === 'cancelled';
}

async function readState(
  tx: FrankTransaction,
  record: WorkbenchRecord,
): Promise<{ state: string; version: number } | null> {
  const rows = await tx.execute<{ state: string; version: number }>(sql`
    select state, version from "frank_domain"."work_item"
    where id = ${record.workItemId} and cell_id = ${record.cellId}
    for update
  `);
  return rows.rows[0] ?? null;
}
