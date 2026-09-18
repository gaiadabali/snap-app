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

/**
 * Australia's GST: 10% on an ex-tax price (1/11 of an inclusive total), and no
 * DPP-style base reduction — `baseFraction: { n: 1, d: 1 }` is the honest
 * statement that Australia has no such adjustment, per
 * `packages/tax-rules/src/contract.ts`'s comment on `ConsumptionTaxSpec
 * .baseFraction`. Every pre-existing test below used to run with 1/11
 * hardcoded inside `taxSubtotalsFromLines`; this is that same fraction,
 * supplied explicitly now that the function asks for it instead of assuming
 * it (docs/STATEMENTS.md §12 ticket S2).
 */
const AU_RATE = { inclusiveFraction: { n: 1, d: 11 }, baseFraction: { n: 1, d: 1 } };

/**
 * Indonesia's PPN: 12% statutory on an 11/12 DPP Nilai Lain base, which is
 * 11/111 of an inclusive total. `packages/tax-rules/src/rules/id-2026.ts`
 * `consumptionTax`. Restated as a literal rather than imported, so this file
 * pins the exact numbers a faktur pajak prints without depending on the
 * built-in rule set object's other fields.
 */
const ID_RATE = { inclusiveFraction: { n: 11, d: 111 }, baseFraction: { n: 11, d: 12 } };

describe('per-category tax subtotals (Peppol BG-23)', () => {
  it('splits a mixed docket the way the ATO actually sees it', () => {
    // The worked example from the generated corpus: $24.50 taxable packaged
    // goods, $11.70 GST-free fresh food, $36.20 total, $2.23 GST printed.
    const subtotals = taxSubtotalsFromLines(
      [line('11.00'), line('4.30'), line('6.40'), line('2.80'), line('2.20', true), line('9.50', true)],
      '2.23',
      '36.20',
      AU_RATE,
    );

    const standard = subtotals.find((s) => s.categoryCode === 'S')!;
    const free = subtotals.find((s) => s.categoryCode === 'Z')!;

    // 24.50 inclusive - 2.23 GST = 22.27 net. AU's baseFraction is 1/1, so the
    // document's stated base is that net amount, unchanged.
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
      AU_RATE,
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
      AU_RATE,
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
    const [standard] = taxSubtotalsFromLines([line('20.00')], '1.81', '20.00', AU_RATE);
    expect(standard!.taxAmount).toBe('1.8100');
    expect(standard!.taxableAmount).toBe('18.1900');
  });

  it('computes GST only when the document prints none', () => {
    const [standard] = taxSubtotalsFromLines([line('110.00')], null, '110.00', AU_RATE);
    expect(standard!.taxAmount).toBe('10.0000');
  });
});

describe('it refuses rather than guessing', () => {
  it('emits nothing when the lines do not reconcile to the payable', () => {
    // Lines sum to 30.00 against a payable of 36.20: part of the receipt was
    // not read. A confident split here would be a split of the wrong money.
    expect(
      taxSubtotalsFromLines([line('20.00'), line('10.00', true)], '1.82', '36.20', AU_RATE),
    ).toEqual([]);
  });

  it('tolerates a cent of till rounding', () => {
    expect(taxSubtotalsFromLines([line('36.19')], '3.29', '36.20', AU_RATE)).toHaveLength(1);
  });

  it('emits nothing when there are no usable lines', () => {
    expect(taxSubtotalsFromLines([], '1.00', '11.00', AU_RATE)).toEqual([]);
    expect(taxSubtotalsFromLines([{ amount: null, gstFree: false }], '1.00', '11.00', AU_RATE)).toEqual(
      [],
    );
  });

  it('omits a category that is not present', () => {
    const allTaxable = taxSubtotalsFromLines([line('22.00')], '2.00', '22.00', AU_RATE);
    expect(allTaxable.map((s) => s.categoryCode)).toEqual(['S']);

    const allFree = taxSubtotalsFromLines([line('22.00', true)], '0', '22.00', AU_RATE);
    expect(allFree.map((s) => s.categoryCode)).toEqual(['Z']);
  });

  it('scores a single-category document as not mixed', () => {
    expect(isMixed(taxSubtotalsFromLines([line('22.00')], '2.00', '22.00', AU_RATE))).toBe(false);
    expect(
      isMixed(
        taxSubtotalsFromLines([line('22.00'), line('10.00', true)], '2.00', '32.00', AU_RATE),
      ),
    ).toBe(true);
  });

  describe('refuses rather than defaulting when no rule set is installed', () => {
    // The important case for S2/S3 together. packages/tax-rules/README.md:
    // "No rule set installed -> every calculation throws." Silently assuming
    // Australia's 1/11 and 1/1 here is exactly the failure that rule exists
    // to prevent, and it is the failure this file's own subtraction used to
    // commit unconditionally.
    it('throws when consumptionTax is undefined', () => {
      // @ts-expect-error — simulating a caller with no rule set resolved
      expect(() => taxSubtotalsFromLines([line('110.00')], null, '110.00', undefined)).toThrow(
        /no default/,
      );
    });

    it('throws when consumptionTax is missing baseFraction', () => {
      expect(() =>
        // @ts-expect-error — a half-supplied rate is still a missing rule set
        taxSubtotalsFromLines([line('110.00')], null, '110.00', {
          inclusiveFraction: { n: 1, d: 11 },
        }),
      ).toThrow(/no default/);
    });
  });
});

describe('money is never a float', () => {
  it('sums 0.10 + 0.20 to exactly 0.30', () => {
    // The float this replaces: 0.1 + 0.2 === 0.30000000000000004.
    const [standard] = taxSubtotalsFromLines([line('0.10'), line('0.20')], '0.03', '0.30', AU_RATE);
    expect(standard!.taxableAmount).toBe('0.2700');
  });

  it('holds across a long docket without drifting', () => {
    const lines = Array.from({ length: 60 }, () => line('0.07'));
    // 60 x 0.07 = 4.20 exactly. A float reduce lands on 4.200000000000001.
    const [standard] = taxSubtotalsFromLines(lines, '0.38', '4.20', AU_RATE);
    expect(standard!.taxableAmount).toBe('3.8200');
  });

  it('reports the GST-free portion exactly', () => {
    const subtotals = taxSubtotalsFromLines(
      [line('24.50'), line('11.70', true)],
      '2.23',
      '36.20',
      AU_RATE,
    );
    expect(gstFreeAmount(subtotals)).toBe('11.7000');
    expect(gstFreeAmount(taxSubtotalsFromLines([line('22.00')], '2.00', '22.00', AU_RATE))).toBeNull();
  });
});

describe('the inclusive figure is sent, not added on the client', () => {
  it('re-adds to the printed total across categories', () => {
    const subtotals = taxSubtotalsFromLines(
      [line('24.50'), line('11.70', true)],
      '2.23',
      '36.20',
      AU_RATE,
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
      taxSubtotalsFromLines([line('63.15'), line('21.05', true)], '3.8727', '84.20', AU_RATE),
    ).toEqual([]);
  });

  it('allows two cents for a till that rounds per line', () => {
    // 22.00 taxable implies 2.00 GST; 2.02 printed is rounding, not disagreement.
    expect(
      taxSubtotalsFromLines([line('22.00'), line('10.00', true)], '2.02', '32.00', AU_RATE),
    ).toHaveLength(2);
  });

  it('still refuses at three cents', () => {
    expect(
      taxSubtotalsFromLines([line('22.00'), line('10.00', true)], '2.03', '32.00', AU_RATE),
    ).toEqual([]);
  });
});

describe('taxable + tax = inclusive must stop being assumed (docs/INDONESIA.md §2.3, ticket S3)', () => {
  it("matches the faktur's printed DPP, not payable minus tax", () => {
    // docs/INDONESIA.md §2.3's worked example, verbatim: a Rp 1,000,000 sale
    // prints DPP Nilai Lain of Rp 916,667 (11/12 of price), PPN 12% x DPP =
    // Rp 110,000, and a payable total of Rp 1,110,000.
    //
    //   payable - tax  = 1,110,000 - 110,000 = 1,000,000   <- WRONG: this is
    //                                                          `price`, not
    //                                                          the printed DPP
    //   DPP (printed)  = price x 11/12        =   916,666.6667 (rounds to
    //                                              916,667 on paper, which has
    //                                              no sub-rupiah unit)
    //
    // Feeding the faktur's own printed figures through must reproduce the
    // printed DPP. Against the pre-fix code (`taxableAmount:
    // money.subtract(taxableInclusive, gst)`), this assertion fails: pre-fix
    // code emits '1000000.0000', not '916666.6667' — run this test against
    // that code first, per docs/STATEMENTS.md §12 ticket S3's "done when".
    const [standard] = taxSubtotalsFromLines(
      [line('1110000.00')],
      '110000.00',
      '1110000.00',
      ID_RATE,
    );

    expect(standard!.taxableAmount).toBe('916666.6667');
    expect(standard!.taxableAmount).not.toBe('1000000.0000');
    expect(standard!.taxAmount).toBe('110000.0000');
    expect(standard!.inclusiveAmount).toBe('1110000.0000');
  });

  it('still uses plain subtraction where baseFraction is 1/1 (AU)', () => {
    // The Australian path is unchanged: netAmount x 1/1 == netAmount.
    const [standard] = taxSubtotalsFromLines([line('110.00')], '10.00', '110.00', AU_RATE);
    expect(standard!.taxableAmount).toBe('100.0000');
  });
});
