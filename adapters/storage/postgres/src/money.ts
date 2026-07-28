/**
 * Exact decimal arithmetic — FRANK-§11.1, FIN-002, FRANK-§20 ("Finance").
 *
 * FIN-002: "Monetary values must use currency plus integer minor units or
 * fixed-precision decimal; floating point is forbidden."
 *
 * Every value in this module is a `bigint` significand plus an integer `scale`.
 * There is no code path that converts through `number`, and the public
 * constructors do not accept `number` at all — not as a convenience overload,
 * not for zero. A `number` parameter is how `0.1 + 0.2 !== 0.3` gets into a
 * ledger, and a type that accepts one is an invitation.
 *
 * Why not integer minor units alone? FRANK-§11.1 permits either, but OPS-001
 * cost events are priced per token: a single input token can cost 3e-7 USD.
 * Rounded to cents that is zero, and a million of them is still zero. So the
 * canonical representation is fixed-precision decimal at scale 8, matching the
 * `numeric(24, 8)` money columns, with `toMinorUnits` available where a payment
 * rail actually needs cents.
 *
 * Why not a decimal library? `bigint` is a language primitive and the operations
 * needed here (add, subtract, multiply, compare, round to scale) are a few dozen
 * lines. FRANK-§0.2: a package does not become a core dependency merely because
 * it could be installed.
 */

import type { CurrencyCode } from '@frank/contracts';

/**
 * Scale of the canonical money columns. Chosen to hold per-token model pricing
 * (1e-8 granularity) without rounding at write time.
 */
export const MONEY_SCALE = 8;

/** Scale of the `quantity` and `unit_price` columns on `cost_event`. */
export const QUANTITY_SCALE = 8;
export const UNIT_PRICE_SCALE = 10;

/**
 * A fixed-precision decimal: `units * 10 ** -scale`.
 *
 * `scale` is always >= 0. Negative scales (i.e. "this number is a multiple of
 * 100") are representable in the SQL standard but they invite silent precision
 * surprises on the round trip, and PostgreSQL `numeric(p, s)` columns in this
 * schema all declare s >= 0.
 */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

/** An amount of money. Currency is part of the value; it is never implied. */
export interface Money extends Decimal {
  readonly currency: CurrencyCode;
}

export type RoundingMode =
  /** Round half away from zero. What a person means by "round". */
  | 'half-up'
  /**
   * Round half to even. IEEE 754 default and the right choice for summing many
   * independently-rounded values, because it does not bias the total upward.
   */
  | 'half-even'
  /** Truncate toward zero. Never silently applied; must be asked for. */
  | 'truncate';

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/* ------------------------------------------------------------- construction */

/**
 * Parse a decimal string. Accepts an optional sign, required integer part, and
 * optional fraction. Rejects exponent notation, whitespace, and empty strings:
 * `1e-7` is how a float got stringified, and accepting it would make the
 * "floating point is forbidden" rule cosmetic.
 */
export function decimal(text: string, scale?: number): Decimal {
  const match = DECIMAL_RE.exec(text);
  if (!match) {
    throw new TypeError(
      `${JSON.stringify(text)} is not a plain decimal literal. ` +
        'Exponent notation and floating-point values are rejected (FIN-002).',
    );
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const parsed: Decimal = {
    units: sign * BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
  return scale === undefined ? parsed : rescale(parsed, scale, 'half-even');
}

/**
 * Build a `Money`. The amount is a string, always.
 *
 * @param currency ISO 4217 alphabetic code, uppercase (FRANK-§11.1).
 */
export function money(currency: CurrencyCode, amount: string, scale = MONEY_SCALE): Money {
  if (!CURRENCY_RE.test(currency)) {
    throw new TypeError(
      `${JSON.stringify(currency)} is not an ISO 4217 alphabetic currency code (FRANK-§11.1).`,
    );
  }
  const value = decimal(amount, scale);
  return { currency, units: value.units, scale: value.scale };
}

/** Zero in `currency`, at the canonical money scale. */
export function zeroMoney(currency: CurrencyCode, scale = MONEY_SCALE): Money {
  return money(currency, '0', scale);
}

/**
 * Build a `Money` from integer minor units and an ISO 4217 exponent
 * (2 for USD/AUD/EUR, 0 for JPY, 3 for BHD). FRANK-§11.1's first permitted
 * representation, offered so callers on a payment rail do not have to hand-build
 * a decimal string.
 */
export function fromMinorUnits(
  currency: CurrencyCode,
  minorUnits: bigint,
  exponent: number,
  scale = MONEY_SCALE,
): Money {
  assertScale(exponent);
  const value = rescale({ units: minorUnits, scale: exponent }, scale, 'half-even');
  return money(currency, renderDecimal(value));
}

/**
 * Convert to integer minor units, rounding explicitly.
 *
 * There is no default rounding mode: choosing one for the caller is how a
 * reconciliation report ends up a cent off with nobody able to say why.
 */
export function toMinorUnits(value: Money, exponent: number, rounding: RoundingMode): bigint {
  assertScale(exponent);
  return rescale(value, exponent, rounding).units;
}

/* ---------------------------------------------------------------- rendering */

/** Render a decimal as a plain literal with exactly `scale` fraction digits. */
export function renderDecimal(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
  const cut = digits.length - value.scale;
  const whole = digits.slice(0, cut);
  const fraction = digits.slice(cut);
  const body = value.scale === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/**
 * The exact string written to a PostgreSQL `numeric` column.
 *
 * `pg` returns `numeric` as a JavaScript string by default and this package
 * never overrides that with a `parseFloat` type parser. That default is the
 * single most important line of defence in FIN-002, so
 * `src/integration/money.integration.test.ts` asserts it against a live server
 * rather than trusting it.
 */
export function toNumericLiteral(value: Decimal): string {
  return renderDecimal(value);
}

/** Parse a `numeric` column value back into a `Money`. */
export function fromNumericLiteral(
  currency: CurrencyCode,
  text: string,
  scale = MONEY_SCALE,
): Money {
  return money(currency, decimalToText(decimal(text)), scale);
}

function decimalToText(value: Decimal): string {
  return renderDecimal(value);
}

/* --------------------------------------------------------------- arithmetic */

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 30) {
    throw new RangeError(`scale must be an integer in [0, 30]; received ${scale}.`);
  }
}

const TEN = 10n;

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

/** Move a decimal to a new scale, rounding when digits are discarded. */
export function rescale(value: Decimal, scale: number, rounding: RoundingMode): Decimal {
  assertScale(scale);
  if (scale === value.scale) return value;
  if (scale > value.scale) {
    return { units: value.units * pow10(scale - value.scale), scale };
  }

  const divisor = pow10(value.scale - scale);
  const negative = value.units < 0n;
  const magnitude = negative ? -value.units : value.units;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;

  let rounded = quotient;
  if (remainder !== 0n && rounding !== 'truncate') {
    const twiceRemainder = remainder * 2n;
    if (twiceRemainder > divisor) {
      rounded += 1n;
    } else if (twiceRemainder === divisor) {
      if (rounding === 'half-up') rounded += 1n;
      else if (quotient % 2n !== 0n) rounded += 1n; // half-even
    }
  }

  return { units: negative ? -rounded : rounded, scale };
}

/** {@link rescale} that keeps the currency. */
export function rescaleMoney(value: Money, scale: number, rounding: RoundingMode): Money {
  const scaled = rescale(value, scale, rounding);
  return { currency: value.currency, units: scaled.units, scale: scaled.scale };
}

function alignedScale(a: Decimal, b: Decimal): number {
  return Math.max(a.scale, b.scale);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(
      `Cannot combine ${a.currency} and ${b.currency} without an explicit, recorded conversion rate (FIN-003).`,
    );
  }
}

/** Exact addition. The result scale is the wider of the two inputs; nothing rounds. */
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const scale = alignedScale(a, b);
  return {
    currency: a.currency,
    units: rescale(a, scale, 'truncate').units + rescale(b, scale, 'truncate').units,
    scale,
  };
}

/** Exact subtraction. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  const scale = alignedScale(a, b);
  return {
    currency: a.currency,
    units: rescale(a, scale, 'truncate').units - rescale(b, scale, 'truncate').units,
    scale,
  };
}

/**
 * Exact sum. Requires at least one element: the currency of an empty sum is
 * undefined, and defaulting it would put a zero of the wrong currency into a
 * report.
 */
export function sumMoney(values: readonly Money[]): Money {
  const first = values[0];
  if (first === undefined) {
    throw new RangeError('sumMoney() requires at least one value; an empty sum has no currency.');
  }
  let total = first;
  for (let i = 1; i < values.length; i += 1) {
    total = addMoney(total, values[i]!);
  }
  return total;
}

/**
 * Exact multiplication of an amount by a dimensionless quantity — the OPS-001
 * "unit price × quantity" case.
 *
 * The full-precision product is returned; the caller decides where to round and
 * with which mode, because the difference between rounding per line item and
 * rounding the invoice total is a real accounting decision, not a default.
 */
export function multiplyMoney(value: Money, factor: Decimal): Money {
  return {
    currency: value.currency,
    units: value.units * factor.units,
    scale: value.scale + factor.scale,
  };
}

/** Exact multiplication of two dimensionless decimals. */
export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

/** `-1`, `0`, or `1`. Exact: compares at the wider scale, never through a float. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return compareDecimal(a, b);
}

export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = alignedScale(a, b);
  const left = rescale(a, scale, 'truncate').units;
  const right = rescale(b, scale, 'truncate').units;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Numeric equality (`1.50 === 1.5`), as distinct from structural equality. */
export function equalsMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && compareDecimal(a, b) === 0;
}

export function isNegative(value: Decimal): boolean {
  return value.units < 0n;
}

export function isZero(value: Decimal): boolean {
  return value.units === 0n;
}

export function negateMoney(value: Money): Money {
  return { ...value, units: -value.units };
}
