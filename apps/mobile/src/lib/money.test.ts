import { describe, expect, it } from 'vitest';

import { formatAud } from './format';
import { ZERO, add, gstFromInclusive, gstOnSale, isZero, multiply, subtract } from './money';

/**
 * Money arithmetic and its display.
 *
 * Written after driving the new-invoice screen surfaced two real faults: GST
 * was carried at 4dp so a billed total was not a whole cent, and `formatAud`
 * truncated rather than rounded, so a displayed subtotal + GST disagreed with
 * the displayed total. Both are one-cent errors, and a one-cent error on an
 * invoice is the kind a customer queries.
 */

describe('exact decimal arithmetic', () => {
  it('adds without float drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. It must here.
    expect(add('0.10', '0.20')).toBe('0.3000');
    expect(add('1888.0000', '261.0000')).toBe('2149.0000');
  });

  it('subtracts, including through zero', () => {
    expect(subtract('110.00', '10.00')).toBe('100.0000');
    expect(subtract('10.00', '110.00')).toBe('-100.0000');
  });

  it('multiplies by whole and fractional quantities', () => {
    expect(multiply('2.9500', 640)).toBe('1888.0000');
    expect(multiply('14.5000', 18)).toBe('261.0000');
    expect(multiply('95.0000', 2.5)).toBe('237.5000');
  });

  it('recognises zero regardless of scale', () => {
    expect(isZero(ZERO)).toBe(true);
    expect(isZero('0.0000')).toBe(true);
    expect(isZero('0.0001')).toBe(false);
  });

  it('rejects junk rather than silently producing NaN', () => {
    expect(() => add('twelve')).toThrow();
  });
});

describe('GST direction — the classic Australian bug', () => {
  it('adds 10% on a SALE', () => {
    expect(gstOnSale('100.00')).toBe('10.0000');
    expect(gstOnSale('2149.0000')).toBe('214.9000');
  });

  it('takes 1/11 out of a GST-INCLUSIVE purchase', () => {
    expect(gstFromInclusive('110.00')).toBe('10.0000');
    expect(gstFromInclusive('1848.00')).toBe('168.0000');
  });

  it('is not symmetric — the two directions must never be swapped', () => {
    // $110 inclusive contains $10 of GST; $110 ex-GST attracts $11.
    expect(gstFromInclusive('110.00')).toBe('10.0000');
    expect(gstOnSale('110.00')).toBe('11.0000');
  });
});

describe('sale GST lands on a whole cent', () => {
  // The bug: 10% of $17.45 is $1.745. Carried at 4dp it displayed as $1.74 and
  // the invoice total came out a cent light.
  it('rounds a half-cent up rather than carrying it', () => {
    expect(gstOnSale('17.45')).toBe('1.7500');
  });

  it('keeps subtotal + GST equal to the total, exactly', () => {
    const net = add(multiply('2.9500', 1), multiply('14.5000', 1)); // 17.4500
    const gst = gstOnSale(net);
    const total = add(net, gst);
    expect(net).toBe('17.4500');
    expect(gst).toBe('1.7500');
    expect(total).toBe('19.2000');
    // And the same must hold once rendered, not only in the maths.
    expect(formatAud(total)).toBe('$19.20');
  });

  it('never produces a fraction of a cent', () => {
    for (const v of ['0.05', '3.33', '17.45', '99.99', '1234.56']) {
      expect(gstOnSale(v).endsWith('00')).toBe(true);
    }
  });
});

describe('formatAud', () => {
  it('rounds to the cent instead of truncating', () => {
    expect(formatAud('1.7450')).toBe('$1.75');
    expect(formatAud('19.1950')).toBe('$19.20');
    expect(formatAud('0.9950')).toBe('$1.00');
  });

  it('groups thousands', () => {
    expect(formatAud('1848.00')).toBe('$1,848.00');
    expect(formatAud('50570.1200')).toBe('$50,570.12');
  });

  it('drops cents on request, still rounding', () => {
    expect(formatAud('50570.1200', { cents: false })).toBe('$50,570');
    expect(formatAud('999.60', { cents: false })).toBe('$1,000');
  });

  it('handles negatives and nulls', () => {
    expect(formatAud('-110.00')).toBe('-$110.00');
    expect(formatAud(null)).toBe('—');
    expect(formatAud(undefined)).toBe('—');
  });
});
