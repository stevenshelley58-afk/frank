/**
 * Cost context — OPS-001, OPS-002, FRANK-§11.2 ("CostEvent, Budget, Allocation,
 * Forecast, Anomaly"), FRANK-§20 ("Cost"), FIN-002.
 *
 * OPS-001: "Every model, media, hosting, storage, and paid connector cost must
 * attach to a run, project, automation, and provider account where possible."
 *
 * All four attachment points are first-class nullable columns, plus
 * `attribution_state` so FRANK-§20's "unknown spend is visible" is a query
 * (`WHERE attribution_state <> 'attributed'`) rather than an inference from
 * nulls. The 98% reconciliation target in FRANK-§20 is measurable directly off
 * this table.
 *
 * ## Every money column is `numeric`, never `double precision`
 *
 * FIN-002: "Monetary values must use currency plus integer minor units or
 * fixed-precision decimal; floating point is forbidden."
 *
 *   `amount`      `numeric(24, 8)`   — 8 fractional digits holds per-token
 *                                      pricing without rounding at write time.
 *   `unit_price`  `numeric(24, 10)`  — wider still, because a unit price is
 *                                      multiplied by a large quantity and the
 *                                      rounding error compounds.
 *   `quantity`    `numeric(24, 8)`   — token counts are integral, but storage is
 *                                      billed in fractional GB-months.
 *
 * `pg` returns `numeric` as a JavaScript string, and this package never installs
 * a type parser that would turn it into a `number`. `src/money.ts` does the
 * arithmetic in `bigint`. `src/integration/money.integration.test.ts` asserts
 * both ends of that against a live server, including a case that a float
 * pipeline gets wrong.
 *
 * A `CHECK (amount <> 'NaN'::numeric)` appears on the money columns because
 * PostgreSQL `numeric` accepts the literal `'NaN'`, and a NaN in a cost column
 * would poison every `SUM` over it while satisfying every other constraint. The
 * comparison is written out rather than using the familiar `x = x` idiom, which
 * does not work here: unlike IEEE 754, PostgreSQL defines numeric NaN as equal
 * to itself.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { domain, durableRecordColumns } from './shared.js';
import { workItem } from './work.js';

/** OPS-001's cost families, verbatim, plus `other` so nothing is unrecordable. */
export const COST_CATEGORIES = [
  'model',
  'media',
  'hosting',
  'storage',
  'connector',
  'sandbox',
  'egress',
  'other',
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

export const costCategoryEnum = domain.enum('cost_category', COST_CATEGORIES);

export const COST_UNITS = [
  'input_token',
  'output_token',
  'cached_input_token',
  'request',
  'image',
  'second',
  'minute',
  'gb_month',
  'gb_transferred',
  'item',
  'flat',
] as const;

export type CostUnit = (typeof COST_UNITS)[number];

export const costUnitEnum = domain.enum('cost_unit', COST_UNITS);

/** FRANK-§20: "unknown spend is visible". */
export const ATTRIBUTION_STATES = ['attributed', 'partial', 'unattributed'] as const;

export type AttributionState = (typeof ATTRIBUTION_STATES)[number];

export const attributionStateEnum = domain.enum('attribution_state', ATTRIBUTION_STATES);

/** FRANK-§4.5 FIN-005: recorded facts, estimates, and suggestions are distinguishable. */
export const COST_CONFIDENCES = ['recorded', 'estimated', 'projected'] as const;

export type CostConfidence = (typeof COST_CONFIDENCES)[number];

export const costConfidenceEnum = domain.enum('cost_confidence', COST_CONFIDENCES);

export const costEvent = domain.table(
  'cost_event',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    category: costCategoryEnum('category').notNull(),
    confidence: costConfidenceEnum('confidence').notNull().default('recorded'),

    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Billing period the provider assigned it to, when that differs. */
    billingPeriod: text('billing_period'),

    /* ---- OPS-001 attachment points ---------------------------------------- */
    runId: uuid('run_id'),
    projectId: uuid('project_id'),
    automationId: uuid('automation_id'),
    providerAccountId: text('provider_account_id'),
    /** Secondary attachments that make a cost explainable in the UI. */
    workItemId: uuid('work_item_id').references(() => workItem.id, { onDelete: 'set null' }),
    agentProfileId: text('agent_profile_id'),
    conversationId: uuid('conversation_id'),

    attributionState: attributionStateEnum('attribution_state').notNull().default('unattributed'),

    providerId: text('provider_id'),
    modelRef: text('model_ref'),

    /* ---- money: exact decimal only (FIN-002) ------------------------------ */
    quantity: numeric('quantity', { precision: 24, scale: 8 }).notNull(),
    unit: costUnitEnum('unit').notNull(),
    unitPrice: numeric('unit_price', { precision: 24, scale: 10 }),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    /** ISO 4217 (FRANK-§11.1). Part of the value; never implied by locale. */
    currency: text('currency').notNull(),
    /**
     * The same amount converted to the cell's reporting currency, with the rate
     * recorded. FIN-003: corrections must be reversible, so the rate that was
     * used is stored, not just the result.
     */
    reportingAmount: numeric('reporting_amount', { precision: 24, scale: 8 }),
    reportingCurrency: text('reporting_currency'),
    exchangeRate: numeric('exchange_rate', { precision: 24, scale: 12 }),

    /** FRANK-§11.5: the provider's usage receipt, referenced not copied. */
    usageReceiptRef: text('usage_receipt_ref'),
    /** Provider-side identifier; unique per (cell, provider) to survive re-sync. */
    externalUsageId: text('external_usage_id'),

    correlationId: text('correlation_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  (t) => [
    // Re-ingesting a provider usage export must not double-count.
    uniqueIndex('cost_event_external_uidx')
      .on(t.cellId, t.providerId, t.externalUsageId)
      .where(sql`${t.externalUsageId} is not null`),
    index('cost_event_occurred_idx').on(t.cellId, t.occurredAt),
    index('cost_event_run_idx').on(t.cellId, t.runId),
    index('cost_event_project_idx').on(t.cellId, t.projectId),
    index('cost_event_automation_idx').on(t.cellId, t.automationId),
    index('cost_event_provider_account_idx').on(t.cellId, t.providerAccountId),
    index('cost_event_unattributed_idx')
      .on(t.cellId, t.occurredAt)
      .where(sql`${t.attributionState} <> 'attributed'`),
    check('cost_event_currency_iso4217', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'cost_event_reporting_currency_iso4217',
      sql`${t.reportingCurrency} is null or ${t.reportingCurrency} ~ '^[A-Z]{3}$'`,
    ),
    // PostgreSQL `numeric` accepts the literal 'NaN', and — unlike IEEE 754 —
    // defines it as equal to itself, so the familiar `x = x` trick does NOT
    // catch it here. The comparison has to be explicit. A NaN in a money column
    // satisfies every other constraint and turns every SUM over the table into
    // NaN (FIN-002).
    check('cost_event_amount_is_number', sql`${t.amount} <> 'NaN'::numeric`),
    check('cost_event_quantity_is_number', sql`${t.quantity} <> 'NaN'::numeric`),
    check(
      'cost_event_unit_price_is_number',
      sql`${t.unitPrice} is null or ${t.unitPrice} <> 'NaN'::numeric`,
    ),
    // A reporting amount without its rate cannot be audited or reversed.
    check(
      'cost_event_reporting_complete',
      sql`(${t.reportingAmount} is null) = (${t.reportingCurrency} is null) and (${t.reportingAmount} is null) = (${t.exchangeRate} is null)`,
    ),
  ],
);

/** OPS-002 budget scopes, verbatim: "per day, month, project, automation, agent, provider, and customer cell". */
export const BUDGET_SCOPES = [
  'day',
  'month',
  'project',
  'automation',
  'agent',
  'provider',
  'cell',
] as const;

export type BudgetScope = (typeof BUDGET_SCOPES)[number];

export const budgetScopeEnum = domain.enum('budget_scope', BUDGET_SCOPES);

/** OPS-002: "Budget test reroutes, slows, or stops according to policy." */
export const BUDGET_ACTIONS = ['warn', 'slow', 'reroute', 'stop'] as const;

export type BudgetAction = (typeof BUDGET_ACTIONS)[number];

export const budgetActionEnum = domain.enum('budget_action', BUDGET_ACTIONS);

export const costBudget = domain.table(
  'cost_budget',
  {
    id: uuid('id').primaryKey(),
    ...durableRecordColumns(),

    scope: budgetScopeEnum('scope').notNull(),
    /** Identifier within the scope; null for `day`, `month`, and `cell`. */
    scopeRef: text('scope_ref'),

    limitAmount: numeric('limit_amount', { precision: 24, scale: 8 }).notNull(),
    currency: text('currency').notNull(),

    /** Fractions of the limit at which each action fires, ascending. */
    warnAtFraction: numeric('warn_at_fraction', { precision: 5, scale: 4 }).notNull().default('0.8000'),
    onExceeded: budgetActionEnum('on_exceeded').notNull().default('stop'),

    periodStart: timestamp('period_start', { withTimezone: true, mode: 'date' }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true, mode: 'date' }).notNull(),
    /** IANA zone the period boundaries are computed in (FRANK-§11.1). */
    periodTimezone: text('period_timezone').notNull(),

    version: numeric('version', { precision: 12, scale: 0 }).notNull().default('1'),
  },
  (t) => [
    uniqueIndex('cost_budget_scope_uidx').on(t.cellId, t.scope, t.scopeRef, t.periodStart),
    index('cost_budget_period_idx').on(t.cellId, t.periodStart, t.periodEnd),
    check('cost_budget_currency_iso4217', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('cost_budget_limit_non_negative', sql`${t.limitAmount} >= 0`),
    check('cost_budget_period_ordered', sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

/**
 * FRANK-§11.2 `Allocation`. A cost event may be split across several attachment
 * targets — one model call serving two projects — and the split is recorded
 * rather than approximated. `CHECK` cannot assert that fractions sum to 1 across
 * rows; `CostRepository.allocate` does, inside the transaction.
 */
export const costAllocation = domain.table(
  'cost_allocation',
  {
    id: uuid('id').primaryKey(),
    cellId: text('cell_id').notNull(),
    costEventId: uuid('cost_event_id')
      .notNull()
      .references(() => costEvent.id, { onDelete: 'cascade' }),
    /** `project` | `automation` | `run` | `agent` | `work_item`. */
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    fraction: numeric('fraction', { precision: 9, scale: 8 }).notNull(),
    amount: numeric('amount', { precision: 24, scale: 8 }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    uniqueIndex('cost_allocation_uidx').on(t.costEventId, t.targetKind, t.targetId),
    index('cost_allocation_target_idx').on(t.cellId, t.targetKind, t.targetId),
    check('cost_allocation_fraction_range', sql`${t.fraction} > 0 and ${t.fraction} <= 1`),
    check('cost_allocation_amount_is_number', sql`${t.amount} <> 'NaN'::numeric`),
  ],
);

export type CostEventRow = typeof costEvent.$inferSelect;
export type NewCostEventRow = typeof costEvent.$inferInsert;
export type CostBudgetRow = typeof costBudget.$inferSelect;
