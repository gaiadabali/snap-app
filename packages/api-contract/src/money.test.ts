import { describe, expect, it } from 'vitest';

import { applyFraction, gstFromInclusive } from './money';

/**
 * `gstFromInclusive` asking the rule set instead of hardcoding 1/11.
 *
 * docs/STATEMENTS.md §12 ticket S2 / docs/INDONESIA.md §2.2, §7.4: this
 * function used to compute `(abs * 2 + 11) / 22` unconditionally — exactly
 * 1/11 — which is Australia's GST fraction and not Indonesia's. Indonesian
 * PPN under DPP Nilai Lain (PMK 131/2024) is 11/111 of an inclusive total,
 * not 1/11. The fraction now has to come from the caller's installed tax
 * rule set (`ConsumptionTaxSpec.inclusiveFraction`); this file never states
 * one itself.
 *
 * Every expected figure below is computed by hand, not by calling the
 * implementation twice — the same discipline `tax-subtotals.test.ts` states.
 */

/** Australia's GST: 10% on an ex-tax price, so 1/11 of the inclusive total. */
const AU_INCLUSIVE_FRACTION = { n: 1, d: 11 };

/**
 * Indonesia's PPN, ID_2026's `consumptionTax.inclusiveFraction`
 * (`packages/tax-rules/src/rules/id-2026.ts`): 12% statutory on an 11/12 DPP
 * Nilai Lain base, which is 11/111 of the inclusive total. Restated as a
 * literal here rather than imported, because this package must not import
 * anything from outside itself (`test/boundaries.test.ts` scans this exact
 * file's twin, `money.ts`, and the whole point of this file's tests is that
 * `@snap/tax-rules` stays that boundary's other side).
 */
const ID_INCLUSIVE_FRACTION = { n: 11, d: 111 };

describe('gstFromInclusive reads the fraction from the rule set', () => {
  it('gives 11/111 under id-2026 and 1/11 under AU, from the same call', () => {
    // docs/INDONESIA.md §2.3's worked example: a faktur payable of
    // Rp 1,110,000 carries exactly Rp 110,000 of PPN (1,110,000 / 111 =
    // 10,000 exactly, x 11 = 110,000).
    const inclusive = '1110000.0000';

    expect(gstFromInclusive(inclusive, ID_INCLUSIVE_FRACTION)).toBe('110000.0000');

    // The same inclusive amount under Australia's 1/11: 1,110,000 / 11 =
    // 100,909.090909... repeating, which rounds half-up at 4dp to
    // 100,909.0909 (the 5th decimal is the '0' that starts the next "0909"
    // repeat, so the 4th decimal does not round up).
    expect(gstFromInclusive(inclusive, AU_INCLUSIVE_FRACTION)).toBe('100909.0909');
  });

  it('still takes exactly 1/11 out of a GST-inclusive purchase under AU', () => {
    // The pre-existing AU behaviour, preserved now that the fraction is a
    // parameter rather than a constant.
    expect(gstFromInclusive('110.00', AU_INCLUSIVE_FRACTION)).toBe('10.0000');
    expect(gstFromInclusive('1848.00', AU_INCLUSIVE_FRACTION)).toBe('168.0000');
  });

  it('restores the sign for a negative (refund) amount', () => {
    expect(gstFromInclusive('-110.00', AU_INCLUSIVE_FRACTION)).toBe('-10.0000');
  });

  describe('refuses rather than defaulting when no rule set is installed', () => {
    // This is the important case. packages/tax-rules/README.md: "No rule set
    // installed -> every calculation throws. There is deliberately no
    // fallback." A caller with nothing resolved from an installed rule set
    // must get a refusal here, not a silent 1/11.

    it('throws when the rate is undefined', () => {
      // @ts-expect-error — simulating a caller with no rule set resolved
      expect(() => gstFromInclusive('110.00', undefined)).toThrow(/no default/);
    });

    it('throws when the rate is null', () => {
      // @ts-expect-error — same failure via a different falsy value
      expect(() => gstFromInclusive('110.00', null)).toThrow(/no default/);
    });

    it('throws on a malformed rate rather than computing garbage', () => {
      // d: 0 type-checks (it is still a `number`) but must never reach a
      // BigInt divide-by-zero.
      expect(() => gstFromInclusive('110.00', { n: 1, d: 0 })).toThrow(/no default/);
      // @ts-expect-error — non-numeric fields
      expect(() => gstFromInclusive('110.00', { n: 'x', d: 11 })).toThrow(/no default/);
    });
  });
});

describe('applyFraction', () => {
  it('is the primitive gstFromInclusive delegates to', () => {
    expect(applyFraction('1110000.0000', ID_INCLUSIVE_FRACTION)).toBe(
      gstFromInclusive('1110000.0000', ID_INCLUSIVE_FRACTION),
    );
  });

  it('applies Indonesia\'s DPP Nilai Lain base fraction (11/12) exactly', () => {
    // docs/INDONESIA.md §2.3: net of 1,000,000 x 11/12 = 916,666.6666... ,
    // which rounds half-up at 4dp to 916,666.6667 — the printed DPP.
    expect(applyFraction('1000000.0000', { n: 11, d: 12 })).toBe('916666.6667');
  });

  it('refuses the same way gstFromInclusive does', () => {
    // @ts-expect-error — no rule set in scope
    expect(() => applyFraction('110.00', undefined)).toThrow(/no default/);
  });
});
