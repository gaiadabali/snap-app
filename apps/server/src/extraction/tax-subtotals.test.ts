import { describe, expect, it } from 'vitest';

import { gstFreeAmount, isMixed, taxSubtotalsFromLines } from './tax-subtotals';

/**
 * The wedge, pinned.
 *
 * Every figure below is computed by hand in the test, never by calling the
 * implementation twice. A corpus or a test that grades code against its own
 * output measures nothing — the same rule `bench/factory` follows for ground
 * truth.
 */

const line = (amount: string, gstFree = false) => ({ amount, gstFree });

describe('per-category tax subtotals (Peppol BG-23)', () => {
  it('splits a mixed docket the way the ATO actually sees it', () => {
    // The worked example from the generated corpus: $24.50 taxable packaged
    // goods, $11.70 GST-free fresh food, $36.20 total, $2.23 GST printed.
    const subtotals = taxSubtotalsFromLines(
      [line('11.00'), line('4.30'), line('6.40'), line('2.80'), line('2.20', true), line('9.50', true)],
      '2.23',
      '36.20',
    );

    const standard = subtotals.find((s) => s.categoryCode === 'S')!;
    const free = subtotals.find((s) => s.categoryCode === 'Z')!;

    // 24.50 inclusive - 2.23 GST = 22.27 net.
    expect(standard.taxableAmount).toBe('22.2700');
    expect(standard.taxAmount).toBe('2.2300');
    expect(standard.rate).toBe('10.0000');

    // GST-free: net and inclusive are the same number.
    expect(free.taxableAmount).toBe('11.7000');
    expect(free.taxAmount).toBe('0.0000');
    expect(free.rate).toBe('0.0000');
  });

  it('is NOT one-eleventh of the header total — the error every competitor makes', () => {
    const subtotals = taxSubtotalsFromLines(
      [line('24.50'), line('11.70', true)],
      '2.23',
      '36.20',
    );
    const gst = subtotals.find((s) => s.categoryCode === 'S')!.taxAmount;

    expect(gst).toBe('2.2300');
    // A header-only reader computes 36.20 / 11 = 3.29 and over-claims by $1.06
    // on one docket. That is the capability gap, in one assertion.
    expect(gst).not.toBe('3.2909');
  });

  it('re-adds to the payable exactly', () => {
    const subtotals = taxSubtotalsFromLines(
      [line('13.37'), line('9.91'), line('4.68', true)],
      '2.12',
      '27.96',
    );
    const total = subtotals.reduce(
      (acc, s) => acc + Number(s.taxableAmount) + Number(s.taxAmount),
      0,
    );
    // Number() here is the TEST checking the implementation's exact strings;
    // the implementation itself never touches a float.
    expect(total).toBeCloseTo(27.96, 4);
  });

  it('uses the PRINTED GST, not a recomputation', () => {
    // A till that rounds differently is still the source of truth for what was
    // charged. 20.00 / 11 = 1.8182, but the paper says 1.81.
    const [standard] = taxSubtotalsFromLines([line('20.00')], '1.81', '20.00');
    expect(standard!.taxAmount).toBe('1.8100');
    expect(standard!.taxableAmount).toBe('18.1900');
  });

  it('computes GST only when the document prints none', () => {
    const [standard] = taxSubtotalsFromLines([line('110.00')], null, '110.00');
    expect(standard!.taxAmount).toBe('10.0000');
  });
});

describe('it refuses rather than guessing', () => {
  it('emits nothing when the lines do not reconcile to the payable', () => {
    // Lines sum to 30.00 against a payable of 36.20: part of the receipt was
    // not read. A confident split here would be a split of the wrong money.
    expect(taxSubtotalsFromLines([line('20.00'), line('10.00', true)], '1.82', '36.20')).toEqual([]);
  });

  it('tolerates a cent of till rounding', () => {
    expect(taxSubtotalsFromLines([line('36.19')], '3.29', '36.20')).toHaveLength(1);
  });

  it('emits nothing when there are no usable lines', () => {
    expect(taxSubtotalsFromLines([], '1.00', '11.00')).toEqual([]);
    expect(taxSubtotalsFromLines([{ amount: null, gstFree: false }], '1.00', '11.00')).toEqual([]);
  });

  it('omits a category that is not present', () => {
    const allTaxable = taxSubtotalsFromLines([line('22.00')], '2.00', '22.00');
    expect(allTaxable.map((s) => s.categoryCode)).toEqual(['S']);

    const allFree = taxSubtotalsFromLines([line('22.00', true)], '0', '22.00');
    expect(allFree.map((s) => s.categoryCode)).toEqual(['Z']);
  });

  it('scores a single-category document as not mixed', () => {
    expect(isMixed(taxSubtotalsFromLines([line('22.00')], '2.00', '22.00'))).toBe(false);
    expect(
      isMixed(taxSubtotalsFromLines([line('22.00'), line('10.00', true)], '2.00', '32.00')),
    ).toBe(true);
  });
});

describe('money is never a float', () => {
  it('sums 0.10 + 0.20 to exactly 0.30', () => {
    // The float this replaces: 0.1 + 0.2 === 0.30000000000000004.
    const [standard] = taxSubtotalsFromLines([line('0.10'), line('0.20')], '0.03', '0.30');
    expect(standard!.taxableAmount).toBe('0.2700');
  });

  it('holds across a long docket without drifting', () => {
    const lines = Array.from({ length: 60 }, () => line('0.07'));
    // 60 x 0.07 = 4.20 exactly. A float reduce lands on 4.200000000000001.
    const [standard] = taxSubtotalsFromLines(lines, '0.38', '4.20');
    expect(standard!.taxableAmount).toBe('3.8200');
  });

  it('reports the GST-free portion exactly', () => {
    const subtotals = taxSubtotalsFromLines(
      [line('24.50'), line('11.70', true)],
      '2.23',
      '36.20',
    );
    expect(gstFreeAmount(subtotals)).toBe('11.7000');
    expect(gstFreeAmount(taxSubtotalsFromLines([line('22.00')], '2.00', '22.00'))).toBeNull();
  });
});

describe('the inclusive figure is sent, not added on the client', () => {
  it('re-adds to the printed total across categories', () => {
    const subtotals = taxSubtotalsFromLines(
      [line('24.50'), line('11.70', true)],
      '2.23',
      '36.20',
    );
    expect(subtotals.find((s) => s.categoryCode === 'S')!.inclusiveAmount).toBe('24.5000');
    expect(subtotals.find((s) => s.categoryCode === 'Z')!.inclusiveAmount).toBe('11.7000');
    // docs/DESIGN-HANDOFF.md §3 forbids client-side arithmetic, so the screen
    // must never have to compute taxable + tax itself.
    const printed = subtotals.reduce((acc, s) => acc + Number(s.inclusiveAmount), 0);
    expect(printed).toBeCloseTo(36.2, 4);
  });
});

describe('the printed GST and the line flags must agree', () => {
  it('emits nothing when they describe different documents', () => {
    // The demo fixture that exposed this: lines mark $63.15 taxable, but the
    // printed GST is $3.87 — one eleventh of $42.60. Attributing $3.87 to `S`
    // still re-adds to the payable, so nothing LOOKS wrong; the screen would
    // just show a taxable portion whose GST is not a tenth of it.
    expect(
      taxSubtotalsFromLines([line('63.15'), line('21.05', true)], '3.8727', '84.20'),
    ).toEqual([]);
  });

  it('allows two cents for a till that rounds per line', () => {
    // 22.00 taxable implies 2.00 GST; 2.02 printed is rounding, not disagreement.
    expect(
      taxSubtotalsFromLines([line('22.00'), line('10.00', true)], '2.02', '32.00'),
    ).toHaveLength(2);
  });

  it('still refuses at three cents', () => {
    expect(
      taxSubtotalsFromLines([line('22.00'), line('10.00', true)], '2.03', '32.00'),
    ).toEqual([]);
  });
});
