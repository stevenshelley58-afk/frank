/**
 * FIN-002 and OPS-001 against a real server.
 *
 * REQUIRES A LIVE POSTGRESQL. `src/money.test.ts` proves the arithmetic is exact
 * in TypeScript. What can only be shown here is that the exactness survives the
 * round trip through the driver: that `numeric` comes back as a string rather
 * than a float, that `sum(numeric)` is exact, and that the same computation done
 * in `double precision` is measurably wrong.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FrankDatabase } from '../db.js';
import { decimal, money, renderDecimal, sumMoney } from '../money.js';
import { CostRepository } from '../repositories/cost.js';
import { costEvent } from '../schema/cost.js';
import {
  CELL,
  PROVENANCE,
  SKIP_REASON,
  closeTestDatabase,
  expectDatabaseError,
  openTestDatabase,
  requiresDatabase,
  resetDatabase,
} from './harness.js';

describe.skipIf(requiresDatabase)(`exact money in PostgreSQL (${SKIP_REASON})`, () => {
  let db: FrankDatabase;
  const cost = new CostRepository();

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(db);
  });

  const now = new Date('2026-07-28T12:00:00.000Z');

  // OPS-001 attachment points are UUID columns, so the fixtures are real UUIDs.
  const RUN_ID = '01920000-0000-7000-8000-0000000000aa';
  const PROJECT_ID = '01920000-0000-7000-8000-0000000000bb';
  const AUTOMATION_ID = '01920000-0000-7000-8000-0000000000cc';

  describe('the driver never turns numeric into a float', () => {
    it('returns numeric as a string', async () => {
      const rows = await db.execute<{ value: unknown }>(
        sql`select 0.1::numeric(24,8) + 0.2::numeric(24,8) as value`,
      );
      expect(typeof rows.rows[0]?.value).toBe('string');
      expect(rows.rows[0]?.value).toBe('0.30000000');
    });

    it('gets the answer that double precision gets wrong', async () => {
      const rows = await db.execute<{ exact: string; approximate: number }>(sql`
        select (0.1::numeric + 0.2::numeric)::text as exact,
               (0.1::float8 + 0.2::float8) as approximate
      `);
      expect(rows.rows[0]?.exact).toBe('0.3');
      expect(rows.rows[0]?.approximate).not.toBe(0.3);
    });

    it('sums 1,000 rows of 0.07 to exactly 70, where float8 does not', async () => {
      const rows = await db.execute<{ exact: string; approximate: number }>(sql`
        select sum(0.07::numeric(24,8))::text as exact,
               sum(0.07::float8) as approximate
        from generate_series(1, 1000)
      `);
      expect(rows.rows[0]?.exact).toBe('70.00000000');
      expect(rows.rows[0]?.approximate).not.toBe(70);
    });
  });

  describe('cost events round-trip exactly', () => {
    async function record(overrides: Parameters<CostRepository['record']>[1]) {
      return db.transaction((tx) => cost.record(tx, overrides));
    }

    const base = {
      cellId: CELL,
      category: 'model' as const,
      occurredAt: now,
      currency: 'USD',
      unit: 'input_token' as const,
      provenance: PROVENANCE,
      actorRef: 'service/model-broker',
      now,
    };

    it('stores a sub-cent per-token price without losing it', async () => {
      const { id } = await record({
        ...base,
        quantity: decimal('1000000'),
        unitPrice: money('USD', '0.0000003', 10),
        runId: RUN_ID,
        projectId: PROJECT_ID,
        automationId: AUTOMATION_ID,
        providerAccountId: 'anthropic/primary',
      });

      const rows = await db.select().from(costEvent).where(sql`${costEvent.id} = ${id}::uuid`);
      expect(rows[0]?.amount).toBe('0.30000000');
      expect(rows[0]?.unitPrice).toBe('0.0000003000');
      expect(rows[0]?.quantity).toBe('1000000.00000000');
      expect(rows[0]?.attributionState).toBe('attributed');
    });

    it('reconciles 100 per-token events to an exact total that float gets wrong', async () => {
      for (let i = 0; i < 100; i += 1) {
        await record({
          ...base,
          quantity: decimal('1000'),
          unitPrice: money('USD', '0.0000003', 10),
        });
      }

      const total = await cost.totalFor(db, {
        cellId: CELL,
        currency: 'USD',
        from: new Date(now.getTime() - 1000),
        to: new Date(now.getTime() + 1000),
      });

      // 100 × 1000 × 0.0000003 = 0.03 exactly.
      expect(renderDecimal(total)).toBe('0.03000000');

      // The same hundred line items accumulated in doubles land on
      // 0.030000000000000075 — a discrepancy a reconciliation report would show.
      const floatTotal = Array.from({ length: 100 }, () => 1000 * 0.0000003).reduce((a, b) => a + b, 0);
      expect(floatTotal).not.toBe(0.03);
    });

    it('derives attribution state from the OPS-001 attachment points', async () => {
      const attributed = await record({
        ...base,
        quantity: decimal('1'),
        amount: money('USD', '1.00'),
        runId: RUN_ID,
        projectId: PROJECT_ID,
        automationId: AUTOMATION_ID,
        providerAccountId: 'anthropic/primary',
      });
      const partial = await record({
        ...base,
        quantity: decimal('1'),
        amount: money('USD', '1.00'),
        runId: RUN_ID,
      });
      const unattributed = await record({ ...base, quantity: decimal('1'), amount: money('USD', '1.00') });

      const states = new Map<string, string>();
      for (const { id } of [attributed, partial, unattributed]) {
        const rows = await db.select().from(costEvent).where(sql`${costEvent.id} = ${id}::uuid`);
        states.set(id, rows[0]!.attributionState);
      }

      expect(states.get(attributed.id)).toBe('attributed');
      expect(states.get(partial.id)).toBe('partial');
      expect(states.get(unattributed.id)).toBe('unattributed');
    });

    it('makes unknown spend visible (FRANK-§20)', async () => {
      await record({
        ...base,
        quantity: decimal('1'),
        amount: money('USD', '10.00'),
        runId: RUN_ID,
        projectId: PROJECT_ID,
        automationId: AUTOMATION_ID,
        providerAccountId: 'anthropic/primary',
      });
      await record({ ...base, quantity: decimal('1'), amount: money('USD', '2.50') });

      const window = { cellId: CELL, currency: 'USD', from: new Date(now.getTime() - 1000), to: new Date(now.getTime() + 1000) };
      expect(renderDecimal(await cost.totalFor(db, window))).toBe('12.50000000');
      expect(renderDecimal(await cost.unattributedTotal(db, window))).toBe('2.50000000');
    });

    it('records a refund as a negative amount without losing precision', async () => {
      await record({ ...base, quantity: decimal('1'), amount: money('USD', '19.99') });
      await record({ ...base, quantity: decimal('1'), amount: money('USD', '-19.99') });

      const total = await cost.totalFor(db, {
        cellId: CELL,
        currency: 'USD',
        from: new Date(now.getTime() - 1000),
        to: new Date(now.getTime() + 1000),
      });
      expect(renderDecimal(total)).toBe('0.00000000');
    });

    it('writes the amount into the outbox event as a string, not a JSON number', async () => {
      const { id } = await record({ ...base, quantity: decimal('1'), amount: money('USD', '0.10') });
      const rows = await db.execute<{ data: { amount: unknown } }>(sql`
        select data from frank_domain.outbox_event where aggregate_id = ${id}
      `);
      expect(typeof rows.rows[0]?.data.amount).toBe('string');
      expect(rows.rows[0]?.data.amount).toBe('0.10000000');
    });
  });

  describe('the schema refuses values that would corrupt a total', () => {
    it('rejects NaN in the amount column', async () => {
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.cost_event
            (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
             category, occurred_at, quantity, unit, amount, currency)
          values
            (gen_random_uuid(), ${CELL}, now(), now(), 's', 's', '{}'::jsonb,
             'model', now(), 1, 'request', 'NaN'::numeric, 'USD')
        `),
      /cost_event_amount_is_number/,
    );
    });

    it('rejects a currency code that is not ISO 4217 alphabetic', async () => {
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.cost_event
            (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
             category, occurred_at, quantity, unit, amount, currency)
          values
            (gen_random_uuid(), ${CELL}, now(), now(), 's', 's', '{}'::jsonb,
             'model', now(), 1, 'request', 1.00, 'usd')
        `),
      /cost_event_currency_iso4217/,
    );
    });

    it('rejects a reporting amount without the rate that produced it', async () => {
      await expectDatabaseError(
        db.execute(sql`
          insert into frank_domain.cost_event
            (id, cell_id, created_at, updated_at, created_by, updated_by, provenance,
             category, occurred_at, quantity, unit, amount, currency, reporting_amount, reporting_currency)
          values
            (gen_random_uuid(), ${CELL}, now(), now(), 's', 's', '{}'::jsonb,
             'model', now(), 1, 'request', 1.00, 'USD', 1.50, 'AUD')
        `),
      /cost_event_reporting_complete/,
    );
    });

    it('has no floating-point column in any cost table', async () => {
      const rows = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = 'frank_domain'
          and data_type in ('real', 'double precision')
      `);
      expect(rows.rows).toEqual([]);
    });
  });

  describe('allocation', () => {
    it('refuses a split whose fractions do not sum to one', async () => {
      const { id } = await db.transaction((tx) =>
        cost.record(tx, {
          cellId: CELL,
          category: 'model',
          occurredAt: now,
          currency: 'USD',
          unit: 'request',
          quantity: decimal('1'),
          amount: money('USD', '10.00'),
          provenance: PROVENANCE,
          actorRef: 's',
          now,
        }),
      );

      await expectDatabaseError(
        db.transaction((tx) =>
          cost.allocate(tx, {
            cellId: CELL,
            costEventId: id,
            currency: 'USD',
            total: money('USD', '10.00'),
            shares: [
              { targetKind: 'project', targetId: 'a', fraction: decimal('0.5'), amount: money('USD', '5.00') },
              { targetKind: 'project', targetId: 'b', fraction: decimal('0.4'), amount: money('USD', '4.00') },
            ],
            actorRef: 's',
            now,
          }),
        ),
      /must sum to exactly 1/,
    );
    });

    it('refuses a split that loses a cent to rounding', async () => {
      const { id } = await db.transaction((tx) =>
        cost.record(tx, {
          cellId: CELL,
          category: 'model',
          occurredAt: now,
          currency: 'USD',
          unit: 'request',
          quantity: decimal('1'),
          amount: money('USD', '10.00'),
          provenance: PROVENANCE,
          actorRef: 's',
          now,
        }),
      );

      // Three equal shares of $10.00 cannot each be $3.33.
      await expectDatabaseError(
        db.transaction((tx) =>
          cost.allocate(tx, {
            cellId: CELL,
            costEventId: id,
            currency: 'USD',
            total: money('USD', '10.00'),
            shares: [
              { targetKind: 'project', targetId: 'a', fraction: decimal('0.33333333'), amount: money('USD', '3.33') },
              { targetKind: 'project', targetId: 'b', fraction: decimal('0.33333333'), amount: money('USD', '3.33') },
              { targetKind: 'project', targetId: 'c', fraction: decimal('0.33333334'), amount: money('USD', '3.33') },
            ],
            actorRef: 's',
            now,
          }),
        ),
      /assign the rounding remainder to one share explicitly/,
    );
    });

    it('accepts a split where the remainder is assigned explicitly', async () => {
      const { id } = await db.transaction((tx) =>
        cost.record(tx, {
          cellId: CELL,
          category: 'model',
          occurredAt: now,
          currency: 'USD',
          unit: 'request',
          quantity: decimal('1'),
          amount: money('USD', '10.00'),
          provenance: PROVENANCE,
          actorRef: 's',
          now,
        }),
      );

      const shares = [
        { targetKind: 'project', targetId: 'a', fraction: decimal('0.33333333'), amount: money('USD', '3.33') },
        { targetKind: 'project', targetId: 'b', fraction: decimal('0.33333333'), amount: money('USD', '3.33') },
        { targetKind: 'project', targetId: 'c', fraction: decimal('0.33333334'), amount: money('USD', '3.34') },
      ];
      expect(renderDecimal(sumMoney(shares.map((s) => s.amount)))).toBe('10.00000000');

      await expect(
        db.transaction((tx) =>
          cost.allocate(tx, {
            cellId: CELL,
            costEventId: id,
            currency: 'USD',
            total: money('USD', '10.00'),
            shares,
            actorRef: 's',
            now,
          }),
        ),
      ).resolves.toBeUndefined();
    });
  });
});
