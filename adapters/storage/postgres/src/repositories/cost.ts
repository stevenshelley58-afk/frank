/**
 * Cost repository — OPS-001, OPS-002, FIN-002, FRANK-§20 ("Cost").
 *
 * Every amount that crosses this boundary is a {@link Money} — a `bigint`
 * significand and a scale — and is rendered to a `numeric` literal on the way
 * into PostgreSQL. There is no `number` in any signature here, so there is no
 * place a float could enter without a deliberate cast that a reviewer would see.
 *
 * FRANK-§20 requires "at least 98% of attributable model and media spend
 * reconciles to a run and project; unknown spend is visible". `attributionState`
 * is derived from which of OPS-001's four attachment points are actually
 * present, rather than being passed in — a caller that could set it to
 * `attributed` while leaving every attachment null would make the reconciliation
 * metric a self-report.
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import type { CurrencyCode } from '@frank/contracts';

import type { FrankExecutor, FrankTransaction } from '../db.js';
import { EVENT_TYPES, buildEventEnvelope, eventSource } from '../events.js';
import { newId } from '../ids.js';
import type { Decimal, Money } from '../money.js';
import {
  MONEY_SCALE,
  money,
  renderDecimal,
  rescale,
  rescaleMoney,
  sumMoney,
  toNumericLiteral,
} from '../money.js';
import { costAllocation, costEvent } from '../schema/cost.js';
import type { AttributionState, CostCategory, CostConfidence, CostUnit } from '../schema/cost.js';
import type { Provenance } from '../schema/shared.js';
import { OutboxRepository } from './outbox.js';

export interface RecordCostInput {
  readonly cellId: string;
  readonly category: CostCategory;
  readonly confidence?: CostConfidence | undefined;
  readonly occurredAt: Date;
  readonly billingPeriod?: string | undefined;

  /** OPS-001's four attachment points. */
  readonly runId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly automationId?: string | undefined;
  readonly providerAccountId?: string | undefined;

  readonly workItemId?: string | undefined;
  readonly agentProfileId?: string | undefined;
  readonly conversationId?: string | undefined;

  readonly providerId?: string | undefined;
  readonly modelRef?: string | undefined;

  readonly quantity: Decimal;
  readonly unit: CostUnit;
  readonly unitPrice?: Money | undefined;
  /** Omit to have it computed exactly as `quantity × unitPrice`. */
  readonly amount?: Money | undefined;
  readonly currency: CurrencyCode;

  readonly reporting?: { amount: Money; rate: Decimal } | undefined;

  readonly usageReceiptRef?: string | undefined;
  readonly externalUsageId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly detail?: Record<string, unknown> | undefined;

  readonly provenance: Provenance;
  readonly actorRef: string;
  readonly now: Date;
}

export class CostRepository {
  readonly #outbox: OutboxRepository;

  constructor(outbox = new OutboxRepository()) {
    this.#outbox = outbox;
  }

  /**
   * Record one cost event.
   *
   * When `amount` is omitted it is computed as `quantity × unitPrice` in exact
   * decimal and then rounded to the column's scale with banker's rounding.
   * Half-even rather than half-up because a cost table is summed: half-up biases
   * every tie upward, and over a month of per-token line items that bias is a
   * real number in the total.
   */
  async record(tx: FrankTransaction, input: RecordCostInput): Promise<{ id: string; amount: Money }> {
    const amount = resolveAmount(input);
    const storedAmount = rescaleMoney(amount, MONEY_SCALE, 'half-even');
    const attributionState = deriveAttributionState(input);
    const id = newId();

    await tx.insert(costEvent).values({
      id,
      cellId: input.cellId,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorRef,
      updatedBy: input.actorRef,
      provenance: input.provenance,
      category: input.category,
      confidence: input.confidence ?? 'recorded',
      occurredAt: input.occurredAt,
      billingPeriod: input.billingPeriod ?? null,
      runId: input.runId ?? null,
      projectId: input.projectId ?? null,
      automationId: input.automationId ?? null,
      providerAccountId: input.providerAccountId ?? null,
      workItemId: input.workItemId ?? null,
      agentProfileId: input.agentProfileId ?? null,
      conversationId: input.conversationId ?? null,
      attributionState,
      providerId: input.providerId ?? null,
      modelRef: input.modelRef ?? null,
      quantity: toNumericLiteral(rescale(input.quantity, 8, 'half-even')),
      unit: input.unit,
      unitPrice:
        input.unitPrice === undefined
          ? null
          : toNumericLiteral(rescaleMoney(input.unitPrice, 10, 'half-even')),
      amount: toNumericLiteral(storedAmount),
      currency: input.currency,
      reportingAmount:
        input.reporting === undefined
          ? null
          : toNumericLiteral(rescaleMoney(input.reporting.amount, MONEY_SCALE, 'half-even')),
      reportingCurrency: input.reporting?.amount.currency ?? null,
      exchangeRate:
        input.reporting === undefined
          ? null
          : toNumericLiteral(rescale(input.reporting.rate, 12, 'half-even')),
      usageReceiptRef: input.usageReceiptRef ?? null,
      externalUsageId: input.externalUsageId ?? null,
      correlationId: input.correlationId ?? null,
      detail: input.detail ?? null,
    });

    const envelope = buildEventEnvelope({
      type: EVENT_TYPES.usageRecorded,
      source: eventSource('cost', id),
      cellId: input.cellId,
      actorId: input.actorRef,
      correlationId: input.correlationId ?? id,
      // Spend is operational metadata, not personal content (FRANK-§2.3).
      classification: 'internal',
      subject: `cost_event/${id}`,
      occurredAt: input.occurredAt,
      ...(input.externalUsageId === undefined
        ? {}
        : { idempotencyKey: `${input.providerId ?? 'unknown'}:${input.externalUsageId}` }),
      data: {
        costEventId: id,
        category: input.category,
        // Rendered as a string: a JSON number here would be a float on the wire
        // and would defeat the whole point of the numeric column (FIN-002).
        amount: renderDecimal(storedAmount),
        currency: input.currency,
        attributionState,
        ...(input.runId === undefined ? {} : { runId: input.runId }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      },
    });

    await this.#outbox.enqueue(tx, envelope, {
      aggregateKind: 'cost_event',
      aggregateId: id,
      createdAt: input.now,
    });

    return { id, amount: storedAmount };
  }

  /**
   * Split a cost across several targets.
   *
   * Refuses unless the fractions sum to exactly 1 and the allocated amounts sum
   * to exactly the event's amount. Both checks, not just the first: rounding
   * each share independently can leave the parts summing to a cent less than the
   * whole even when the fractions are perfect, and a reconciliation report that
   * is a cent short is a report nobody trusts.
   */
  async allocate(
    tx: FrankTransaction,
    input: {
      cellId: string;
      costEventId: string;
      currency: CurrencyCode;
      total: Money;
      shares: ReadonlyArray<{ targetKind: string; targetId: string; fraction: Decimal; amount: Money }>;
      actorRef: string;
      now: Date;
    },
  ): Promise<void> {
    const fractionTotal = input.shares.reduce(
      (acc, share) => acc + rescale(share.fraction, 8, 'truncate').units,
      0n,
    );
    if (fractionTotal !== 100_000_000n) {
      throw new RangeError(
        `Cost allocation fractions must sum to exactly 1; they sum to ${renderDecimal({ units: fractionTotal, scale: 8 })} (OPS-001).`,
      );
    }

    const allocated = sumMoney(input.shares.map((share) => share.amount));
    const target = rescale(input.total, MONEY_SCALE, 'truncate');
    if (rescale(allocated, MONEY_SCALE, 'truncate').units !== target.units) {
      throw new RangeError(
        `Cost allocation amounts sum to ${renderDecimal(allocated)} but the event is ${renderDecimal(target)} ${input.currency}; ` +
          'assign the rounding remainder to one share explicitly rather than losing it (FIN-002).',
      );
    }

    for (const share of input.shares) {
      await tx.insert(costAllocation).values({
        id: newId(),
        cellId: input.cellId,
        costEventId: input.costEventId,
        targetKind: share.targetKind,
        targetId: share.targetId,
        fraction: toNumericLiteral(rescale(share.fraction, 8, 'half-even')),
        amount: toNumericLiteral(rescaleMoney(share.amount, MONEY_SCALE, 'half-even')),
        currency: share.amount.currency,
        createdAt: input.now,
        createdBy: input.actorRef,
      });
    }
  }

  /**
   * Exact total over a period, summed in the database.
   *
   * `sum(numeric)` returns `numeric`, `pg` returns it as a string, and
   * {@link money} parses it as a decimal. No step passes through a float.
   */
  async totalFor(
    db: FrankExecutor,
    input: { cellId: string; currency: CurrencyCode; from: Date; to: Date },
  ): Promise<Money> {
    const rows = await db
      .select({ total: sql<string | null>`sum(${costEvent.amount})` })
      .from(costEvent)
      .where(
        and(
          eq(costEvent.cellId, input.cellId),
          eq(costEvent.currency, input.currency),
          gte(costEvent.occurredAt, input.from),
          lt(costEvent.occurredAt, input.to),
        ),
      );

    const total = rows[0]?.total;
    return total === null || total === undefined
      ? money(input.currency, '0')
      : money(input.currency, total);
  }

  /** FRANK-§20: "unknown spend is visible." */
  async unattributedTotal(
    db: FrankExecutor,
    input: { cellId: string; currency: CurrencyCode; from: Date; to: Date },
  ): Promise<Money> {
    const rows = await db
      .select({ total: sql<string | null>`sum(${costEvent.amount})` })
      .from(costEvent)
      .where(
        and(
          eq(costEvent.cellId, input.cellId),
          eq(costEvent.currency, input.currency),
          gte(costEvent.occurredAt, input.from),
          lt(costEvent.occurredAt, input.to),
          sql`${costEvent.attributionState} <> 'attributed'`,
        ),
      );

    const total = rows[0]?.total;
    return total === null || total === undefined
      ? money(input.currency, '0')
      : money(input.currency, total);
  }
}

function resolveAmount(input: RecordCostInput): Money {
  if (input.amount !== undefined) {
    if (input.amount.currency !== input.currency) {
      throw new TypeError(
        `Cost amount is in ${input.amount.currency} but the event declares ${input.currency}.`,
      );
    }
    return input.amount;
  }
  if (input.unitPrice === undefined) {
    throw new TypeError(
      'A cost event needs either an explicit amount or a unit price to multiply by its quantity (OPS-001).',
    );
  }
  if (input.unitPrice.currency !== input.currency) {
    throw new TypeError(
      `Unit price is in ${input.unitPrice.currency} but the event declares ${input.currency}.`,
    );
  }
  return {
    currency: input.currency,
    units: input.unitPrice.units * input.quantity.units,
    scale: input.unitPrice.scale + input.quantity.scale,
  };
}

/**
 * OPS-001 attaches a cost to "a run, project, automation, and provider account
 * where possible". All four present is `attributed`; some is `partial`; none is
 * `unattributed` and shows up in the FRANK-§20 unknown-spend figure.
 */
function deriveAttributionState(input: RecordCostInput): AttributionState {
  const attachments = [input.runId, input.projectId, input.automationId, input.providerAccountId];
  const present = attachments.filter((value) => value !== undefined && value !== '').length;
  if (present === attachments.length) return 'attributed';
  if (present === 0) return 'unattributed';
  return 'partial';
}
