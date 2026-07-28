/**
 * FIN-002: "Monetary values must use currency plus integer minor units or
 * fixed-precision decimal; floating point is forbidden."
 * FRANK-§20 ("Finance"): "A statement and receipts reconcile without
 * floating-point errors."
 *
 * Several tests below compute the float answer alongside the exact one and
 * assert that they differ. That is the point: a test that only checks the exact
 * result would still pass if someone quietly reintroduced a `number`, because
 * most values round-trip fine. The cases here are chosen so that they do not.
 */

import { describe, expect, it } from 'vitest';

import {
  MONEY_SCALE,
  addMoney,
  compareMoney,
  decimal,
  equalsMoney,
  fromMinorUnits,
  fromNumericLiteral,
  isNegative,
  isZero,
  money,
  multiplyDecimal,
  multiplyMoney,
  negateMoney,
  renderDecimal,
  rescale,
  rescaleMoney,
  subtractMoney,
  sumMoney,
  toMinorUnits,
  toNumericLiteral,
  zeroMoney,
} from './money.js';

const AUD = 'AUD';
const USD = 'USD';

describe('cases that a float pipeline gets wrong', () => {
  it('adds 0.1 and 0.2 to exactly 0.3', () => {
    const exact = addMoney(money(AUD, '0.10'), money(AUD, '0.20'));
    expect(renderDecimal(exact)).toBe('0.30000000');
    expect(equalsMoney(exact, money(AUD, '0.30'))).toBe(true);

    // The same arithmetic in IEEE 754 doubles, for contrast.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(Number(renderDecimal(exact))).toBe(0.3); // only after exact arithmetic
  });

  it('sums a receipt of 1,000 × $0.07 to exactly $70.00, where float lands short', () => {
    const lines = Array.from({ length: 1000 }, () => money(AUD, '0.07'));
    const exact = sumMoney(lines);
    expect(renderDecimal(exact)).toBe('70.00000000');

    let floatTotal = 0;
    for (let i = 0; i < 1000; i += 1) floatTotal += 0.07;
    expect(floatTotal).not.toBe(70);
    expect(Math.abs(floatTotal - 70)).toBeGreaterThan(1e-13);
  });

  it('reconciles a statement against its lines to exactly zero', () => {
    // FRANK-§20 "Finance": statement total minus the sum of its receipts.
    const lines = ['0.10', '0.20', '0.30', '10.05', '0.35', '99.99', '1.11', '2.22', '3.33'];
    const statementTotal = money(AUD, '117.65');

    const difference = subtractMoney(statementTotal, sumMoney(lines.map((l) => money(AUD, l))));
    expect(isZero(difference)).toBe(true);
    expect(renderDecimal(difference)).toBe('0.00000000');

    // The same reconciliation in doubles is off by 1.4e-14 and reports a
    // discrepancy that does not exist.
    const floatDifference = 117.65 - lines.map(Number).reduce((a, b) => a + b, 0);
    expect(floatDifference).not.toBe(0);
  });

  it('prices 1,000,000 input tokens at $0.0000003 each to exactly $0.30', () => {
    // OPS-001: model spend is per token and the unit price is far below a cent.
    const unitPrice = money(USD, '0.0000003', 10);
    const quantity = decimal('1000000');
    const amount = multiplyMoney(unitPrice, quantity);

    expect(renderDecimal(rescaleMoney(amount, MONEY_SCALE, 'half-even'))).toBe('0.30000000');
  });

  it('keeps a sub-cent unit price that rounding to minor units would erase', () => {
    const unitPrice = money(USD, '0.0000003', 10);
    expect(isZero(unitPrice)).toBe(false);
    // The same value as integer cents is zero, and a million of them is still zero.
    expect(toMinorUnits(unitPrice, 2, 'half-even')).toBe(0n);
  });

  it('handles a value that cannot be represented as a double at all', () => {
    const big = money(USD, '12345678901234567.89');
    expect(renderDecimal(addMoney(big, money(USD, '0.01')))).toBe('12345678901234567.90000000');
    // The float version silently loses the cent.
    expect(12345678901234567.89 + 0.01).toBe(12345678901234568);
  });
});

describe('parsing', () => {
  it('accepts a plain decimal literal with or without a sign or fraction', () => {
    expect(renderDecimal(decimal('0'))).toBe('0');
    expect(renderDecimal(decimal('-0'))).toBe('0');
    expect(renderDecimal(decimal('12'))).toBe('12');
    expect(renderDecimal(decimal('-12.345'))).toBe('-12.345');
    expect(renderDecimal(decimal('+12.345'))).toBe('12.345');
    expect(renderDecimal(decimal('0.000000001'))).toBe('0.000000001');
  });

  it('rejects exponent notation, which is how a stringified float sneaks in', () => {
    for (const bogus of ['1e-7', '1E7', '1.5e3', 'Infinity', 'NaN', '', ' 1', '1 ', '1,5', '.5', '5.']) {
      expect(() => decimal(bogus), bogus).toThrow(TypeError);
    }
  });

  it('rejects a currency code that is not ISO 4217 alphabetic', () => {
    for (const bogus of ['aud', 'AUDD', 'AU', '036', '', 'A$']) {
      expect(() => money(bogus, '1.00')).toThrow(TypeError);
    }
  });

  it('preserves trailing zeros as scale, so 1.50 and 1.5 are numerically equal', () => {
    expect(equalsMoney(money(AUD, '1.50'), money(AUD, '1.5'))).toBe(true);
    expect(compareMoney(money(AUD, '1.50'), money(AUD, '1.5'))).toBe(0);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly at the wider of the two scales', () => {
    const a = money(USD, '1.005', 3);
    const b = money(USD, '2.5', 1);
    expect(renderDecimal(addMoney(a, b))).toBe('3.505');
    expect(renderDecimal(subtractMoney(a, b))).toBe('-1.495');
  });

  it('multiplies without rounding, keeping the full product scale', () => {
    const product = multiplyMoney(money(USD, '0.07', 2), decimal('3'));
    expect(renderDecimal(product)).toBe('0.21');

    const wide = multiplyDecimal(decimal('1.11111111'), decimal('2.22222222'));
    expect(renderDecimal(wide)).toBe('2.4691357975308642');
  });

  it('refuses to combine two currencies without an explicit conversion', () => {
    expect(() => addMoney(money(USD, '1'), money(AUD, '1'))).toThrow(/without an explicit/);
    expect(() => subtractMoney(money(USD, '1'), money(AUD, '1'))).toThrow(TypeError);
    expect(() => compareMoney(money(USD, '1'), money(AUD, '1'))).toThrow(TypeError);
  });

  it('refuses to sum an empty list rather than inventing a currency', () => {
    expect(() => sumMoney([])).toThrow(RangeError);
  });

  it('negates and detects sign exactly', () => {
    const value = money(AUD, '-12.34');
    expect(isNegative(value)).toBe(true);
    expect(isNegative(negateMoney(value))).toBe(false);
    expect(renderDecimal(negateMoney(value))).toBe('12.34000000');
    expect(isZero(zeroMoney(AUD))).toBe(true);
  });

  it('compares exactly across scales', () => {
    expect(compareMoney(money(USD, '1.001', 3), money(USD, '1.0', 1))).toBe(1);
    expect(compareMoney(money(USD, '1.0', 1), money(USD, '1.001', 3))).toBe(-1);
    expect(compareMoney(money(USD, '1.000', 3), money(USD, '1', 0))).toBe(0);
  });
});

describe('rounding', () => {
  it('rounds half away from zero under half-up', () => {
    expect(renderDecimal(rescale(decimal('2.5'), 0, 'half-up'))).toBe('3');
    expect(renderDecimal(rescale(decimal('3.5'), 0, 'half-up'))).toBe('4');
    expect(renderDecimal(rescale(decimal('-2.5'), 0, 'half-up'))).toBe('-3');
  });

  it('rounds half to even under half-even, so long sums do not drift upward', () => {
    expect(renderDecimal(rescale(decimal('2.5'), 0, 'half-even'))).toBe('2');
    expect(renderDecimal(rescale(decimal('3.5'), 0, 'half-even'))).toBe('4');
    expect(renderDecimal(rescale(decimal('-2.5'), 0, 'half-even'))).toBe('-2');
    expect(renderDecimal(rescale(decimal('0.125'), 2, 'half-even'))).toBe('0.12');
    expect(renderDecimal(rescale(decimal('0.135'), 2, 'half-even'))).toBe('0.14');
  });

  it('does not bias a long run of ties, where half-up would', () => {
    // 200 values of 0.005 rounded to cents: half-even splits them, half-up does not.
    const halfEven = Array.from({ length: 200 }, (_, i) =>
      rescale(decimal(`${i}.005`), 2, 'half-even'),
    );
    const halfUp = Array.from({ length: 200 }, (_, i) => rescale(decimal(`${i}.005`), 2, 'half-up'));

    const evenTotal = halfEven.reduce((acc, v) => acc + v.units, 0n);
    const upTotal = halfUp.reduce((acc, v) => acc + v.units, 0n);
    expect(upTotal).toBeGreaterThan(evenTotal);
  });

  it('truncates toward zero only when asked', () => {
    expect(renderDecimal(rescale(decimal('2.9'), 0, 'truncate'))).toBe('2');
    expect(renderDecimal(rescale(decimal('-2.9'), 0, 'truncate'))).toBe('-2');
  });

  it('widens the scale losslessly', () => {
    expect(renderDecimal(rescale(decimal('1.5'), 8, 'half-even'))).toBe('1.50000000');
  });

  it('rejects a scale outside [0, 30]', () => {
    for (const scale of [-1, 31, 1.5, Number.NaN]) {
      expect(() => rescale(decimal('1'), scale, 'half-even')).toThrow(RangeError);
    }
  });
});

describe('minor units (FRANK-§11.1 first permitted representation)', () => {
  it('round-trips a two-decimal currency', () => {
    const value = fromMinorUnits(AUD, 123_456n, 2);
    expect(renderDecimal(value)).toBe('1234.56000000');
    expect(toMinorUnits(value, 2, 'half-even')).toBe(123_456n);
  });

  it('handles a zero-decimal currency', () => {
    const jpy = fromMinorUnits('JPY', 1234n, 0);
    expect(renderDecimal(jpy)).toBe('1234.00000000');
    expect(toMinorUnits(jpy, 0, 'half-even')).toBe(1234n);
  });

  it('handles a three-decimal currency', () => {
    const bhd = fromMinorUnits('BHD', 1_234n, 3);
    expect(renderDecimal(bhd)).toBe('1.23400000');
    expect(toMinorUnits(bhd, 3, 'half-even')).toBe(1_234n);
  });

  it('requires the caller to pick a rounding mode when narrowing', () => {
    const value = money(USD, '1.005');
    expect(toMinorUnits(value, 2, 'half-up')).toBe(101n);
    expect(toMinorUnits(value, 2, 'half-even')).toBe(100n);
    expect(toMinorUnits(value, 2, 'truncate')).toBe(100n);
  });
});

describe('numeric column round trip', () => {
  it('renders exactly the literal PostgreSQL stores', () => {
    expect(toNumericLiteral(money(USD, '1.5'))).toBe('1.50000000');
    expect(toNumericLiteral(money(USD, '-0.00000001'))).toBe('-0.00000001');
    expect(toNumericLiteral(money(USD, '0'))).toBe('0.00000000');
  });

  it('parses a numeric column value back to the same value', () => {
    for (const literal of ['0.00000000', '1234.56000000', '-0.00000001', '999999999999999.99999999']) {
      expect(toNumericLiteral(fromNumericLiteral(USD, literal))).toBe(literal);
    }
  });
});
