import { AU_2025, AU_2026, AU_2027, ID_2026, checkTaxId, rationalsEqual, taxFromInclusive } from '@snap/tax-rules';
import { describe, expect, it } from 'vitest';

import type { TenantRow } from '../repo.js';
import { readerRulesFor } from '../taxrules/taxrules.repo.js';
import { BUILTIN, taxNameForCountry } from '../taxrules/tax-name.js';
import { BUYER_ABN_THRESHOLD, TAX_INVOICE_THRESHOLD, expectedGst, jurisdictionOf } from './validators.js';

/**
 * TWO STATEMENTS OF AUSTRALIA, KEPT IN STEP.
 *
 * Australia's receipt reader is `jurisdictionOf(null)` — the constants this
 * file has always had. `au-2026` states Australia a second time, as data, so
 * a person can pick it at sign-up. An Australian workspace with `au-2026`
 * installed is read by the FIRST (`readerRulesFor` maps it to `null`), so the
 * second must never say something different about a fact both of them state:
 * if one moves alone, this fails and names the fact.
 */

const AU = jurisdictionOf(null);

// Every Australian year, not only the current one: an Australian receipt is
// read by the reader whichever year its date falls in.
for (const YEAR of [AU_2025, AU_2026, AU_2027]) {
  describe(`${YEAR.id} agrees with the Australian reader`, () => {
    it('names the same tax, tax id, currency and tax-invoice wording', () => {
      expect(YEAR.consumptionTax.name).toBe(AU.taxName);
      expect(YEAR.taxId.name).toBe(AU.taxIdName);
      expect(YEAR.taxId.checksum !== null).toBe(AU.taxIdCheckable);
      expect(YEAR.currency.code).toBe(AU.currency);
      expect(YEAR.documentRules.taxInvoiceTokens).toEqual(AU.taxInvoiceTokens);
      expect(YEAR.documentRules.validityDecidableFromDocument).toBe(AU.validityDecidable);
      expect(YEAR.documentRules.plausibleAgeYears).toBe(AU.plausibleAgeYears);
      expect(YEAR.otherTaxes).toEqual([]);
      expect(AU.otherTaxes).toEqual([]);
    });

    it('takes exactly 1/11, as "Exactly 1/11 of the taxable amount" promises', () => {
      expect(rationalsEqual(YEAR.consumptionTax.inclusiveFraction, { n: 1, d: 11 })).toBe(true);
      // The reader keeps four decimal places; the rule set rounds to the cent.
      // Same fraction, so the two agree to the cent on any amount.
      for (const inclusive of ['110.00', '266.91', '84.20', '0.99', '12345.67']) {
        const reader = Number(expectedGst(inclusive));
        const rules = Number(taxFromInclusive(YEAR, inclusive).taxAmount);
        expect(Math.abs(reader - rules)).toBeLessThanOrEqual(0.005);
      }
    });

    it('keeps the tax-invoice thresholds in the reader, where the contract has no slot', () => {
      // GST Act s 29-70: a tax invoice above $82.50 incl. GST; the buyer named
      // at $1,000. A rule-set-built jurisdiction would drop these, which is one
      // reason an Australian workspace never gets one.
      expect(AU.taxInvoiceThreshold).toBe(TAX_INVOICE_THRESHOLD);
      expect(AU.buyerIdThreshold).toBe(BUYER_ABN_THRESHOLD);
      expect(jurisdictionOf(YEAR).taxInvoiceThreshold).toBeNull();
    });

    it('checks the same ABN the same way', () => {
      expect(checkTaxId(YEAR, '51824753556').ok).toBe(true);
      expect(checkTaxId(YEAR, '51824753557').ok).toBe(false);
    });
  });
}

describe('the catalogue and the reader mapping', () => {
  const tenant = (over: Partial<TenantRow>): TenantRow => ({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test',
    kind: 'personal',
    abn: null,
    abn_valid: null,
    gst_registered: false,
    gst_basis: 'cash',
    simpler_bas: false,
    occupation_profile_id: null,
    financial_year_start_month: 7,
    country: 'AU',
    base_currency: 'AUD',
    tax_rules_id: null,
    tax_rules_version: null,
    ...over,
  });

  it('ships three Australian years and Indonesia', () => {
    expect(BUILTIN.map((r) => r.id)).toEqual(['au-2025', 'au-2026', 'au-2027', 'id-2026']);
    expect(taxNameForCountry('AU')).toBe('GST');
    expect(taxNameForCountry('ID')).toBe('PPN');
  });

  it('reads an Australian workspace with au-2026 exactly as one with no rule set, in every year', async () => {
    for (const date of ['2025-03-01', '2026-03-15', '2026-11-26', '2027-07-01', '2030-01-01']) {
      expect(await readerRulesFor(tenant({}), date)).toBeNull();
      expect(
        await readerRulesFor(tenant({ tax_rules_id: 'au-2026', tax_rules_version: AU_2026.version }), date),
      ).toBeNull();
    }
  });

  it('still refuses an Australian workspace whose rule set is the wrong version', async () => {
    await expect(
      readerRulesFor(tenant({ tax_rules_id: 'au-2026', tax_rules_version: '2025.9.9' }), '2026-11-26'),
    ).rejects.toThrow(/2025\.9\.9 installed/);
  });

  it('hands Indonesia its own rule set, never Australia', async () => {
    const rules = await readerRulesFor(
      tenant({ country: 'ID', base_currency: 'IDR', tax_rules_id: 'id-2026', tax_rules_version: ID_2026.version }),
      '2026-11-26',
    );
    expect(rules?.id).toBe('id-2026');
  });
});
