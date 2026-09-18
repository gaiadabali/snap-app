import { describe, expect, it } from 'vitest';

import { ID_2026 } from '@snap/tax-rules';

import { applyFraction, gstFromInclusive, money } from '../src/money';

/**
 * `gstFromInclusive` asking the rule set instead of hardcoding 1/11.
 *
 * docs/STATEMENTS.md §12 ticket S2 / docs/INDONESIA.md §2.2, §7.4: this
 * function used to compute `(abs * 2 + 11) / 22` unconditionally — exactly
 * 1/11 — which is Australia's GST fraction, not Indonesia's. The fraction now
 * has to come from the caller's installed tax rule set
 * (`ConsumptionTaxSpec.inclusiveFraction`); this file never states one
 * itself. Uses the REAL shipped `ID_2026` rule set from `@snap/tax-rules`
 * (already a devDependency of this package, per `test/tax_rules.test.ts`),
 * not a hand-rolled fraction, so a rate change to the rule set is a change
 * these tests would feel.
 *
 * No DATABASE_URL needed — this is pure arithmetic, unlike the rest of
 * `packages/db/test/`.
 */

const AU_INCLUSIVE_FRACTION = { n: 1, d: 11 };

describe('gstFromInclusive reads the fraction from the rule set', () => {
  it('gives 11/111 under id-2026 and 1/11 under AU, from the same call', () => {
    // docs/INDONESIA.md §2.3's worked example: a faktur payable of
    // Rp 1,110,000 carries exactly Rp 110,000 of PPN (1,110,000 / 111 =
    // 10,000 exactly, x 11 = 110,000).
    const inclusive = money('1110000');

    expect(gstFromInclusive(inclusive, ID_2026.consumptionTax.inclusiveFraction)).toBe(
      '110000.0000',
    );

    // Same inclusive amount under Australia's 1/11: 1,110,000 / 11 =
    // 100,909.090909... repeating, which rounds half-up at 4dp to
    // 100,909.0909 (the 5th decimal is the '0' that starts the next "0909"
    // repeat, so the 4th decimal does not round up).
    expect(gstFromInclusive(inclusive, AU_INCLUSIVE_FRACTION)).toBe('100909.0909');
  });

  it('still takes exactly 1/11 out of a GST-inclusive purchase under AU', () => {
    expect(gstFromInclusive(money('110'), AU_INCLUSIVE_FRACTION)).toBe('10.0000');
  });

  describe('refuses rather than defaulting when no rule set is installed', () => {
    // The important case. packages/tax-rules/README.md: "No rule set
    // installed -> every calculation throws. There is deliberately no
    // fallback." A silently assumed 1/11 for a jurisdiction that is not
    // Australia is exactly the failure that rule exists to prevent.

    it('throws when the rate is undefined', () => {
      // @ts-expect-error — simulating a caller with no rule set resolved
      expect(() => gstFromInclusive(money('110'), undefined)).toThrow(/no default/);
    });

    it('throws when the rate is null', () => {
      // @ts-expect-error — same failure via a different falsy value
      expect(() => gstFromInclusive(money('110'), null)).toThrow(/no default/);
    });

    it('throws on a malformed rate rather than computing garbage', () => {
      // d: 0 type-checks (it is still a `number`) but must never reach a
      // BigInt divide-by-zero.
      expect(() => gstFromInclusive(money('110'), { n: 1, d: 0 })).toThrow(/no default/);
    });
  });
});

describe('applyFraction', () => {
  it('applies Indonesia\'s DPP Nilai Lain base fraction (11/12) exactly', () => {
    // docs/INDONESIA.md §2.3: net of 1,000,000 x 11/12 = 916,666.6666...,
    // which rounds half-up at 4dp to 916,666.6667 — the printed DPP.
    expect(applyFraction(money('1000000'), ID_2026.consumptionTax.baseFraction)).toBe(
      '916666.6667',
    );
  });

  it('agrees with the AU rule set that baseFraction 1/1 changes nothing', () => {
    // Australia has no DPP-style base reduction — contract.ts documents 1/1
    // as the honest statement of "no adjustment", not a placeholder.
    expect(applyFraction(money('1000000'), { n: 1, d: 1 })).toBe('1000000.0000');
  });
});
