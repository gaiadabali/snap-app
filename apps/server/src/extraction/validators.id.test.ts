import { ID_2026 } from '@snap/tax-rules';
import { describe, expect, it } from 'vitest';

import { dateProblem, expectedGst, periodKey, validate } from './validators.js';
import type { Extraction } from './types.js';

/**
 * THE SAME RECEIPT, READ UNDER TWO JURISDICTIONS.
 *
 * `validators.test.ts` next door proves the Australian behaviour and must keep
 * passing unchanged — that is what says this change parameterised the rules
 * rather than replacing them.
 *
 * What this file proves is the other half: that an Indonesian document read
 * with `null` rules is comprehensively WRONG, and read with `ID_2026` is right.
 * Before this, every Indonesian receipt would have been flagged with a GST
 * arithmetic complaint, a missing ABN, a missing "tax invoice" marking and a
 * foreign-currency warning — four false failures on a perfectly ordinary
 * docket, which is the fastest way to teach a reviewer to ignore findings.
 */

const f = <T>(value: T, confidence = 0.99) => ({ value, confidence });

/** A clean Indonesian retail docket: Rp 1,110,000 incl, PPN Rp 110,000. */
function indonesianDocket(over: Partial<Extraction> = {}): Extraction {
  return {
    schemaVersion: '1',
    docType: f('receipt' as const),
    saysTaxInvoice: f(false),
    documentNumber: f('INV-2026-0042'),
    issueDate: f('2026-06-15'),
    currency: f('IDR'),
    supplierName: f('Toko Sederhana'),
    supplierAbn: f('3171234567890002'), // a 16-digit NPWP (NIK form)
    buyerIdentified: f(false),
    taxExclusiveAmount: f('1000000'),
    taxAmount: f('110000'),
    payableAmount: f('1110000'),
    lines: [],
    notes: { legible: true, imageIssues: [], warnings: [] },
    ...over,
  } as Extraction;
}

const codes = (v: ReturnType<typeof validate>) => v.findings.map((x) => x.code);

describe('an Indonesian receipt read under Australian rules', () => {
  it('is wrong in four separate ways', () => {
    // This is what shipped before the rule set reached the validator, and it
    // is why "the engine exists but the reader does not consult it" was not a
    // cosmetic gap.
    const v = validate(indonesianDocket(), new Date('2026-09-17'));
    // 1/11 of 1,110,000 is 100,909 — so the correct PPN reads as an error.
    expect(codes(v)).toContain('gst_arithmetic');
    // A 16-digit NPWP fails the 11-digit ABN checksum.
    expect(codes(v)).toContain('supplier_abn_invalid');
    // The words "tax invoice" are not on an Indonesian docket.
    expect(codes(v)).toContain('not_marked_tax_invoice');
    // IDR is not AUD.
    expect(codes(v)).toContain('foreign_currency');
  });
});

describe('the same receipt read under ID_2026', () => {
  const v = validate(indonesianDocket(), new Date('2026-09-17'), ID_2026);

  it('accepts the PPN arithmetic, because 11/111 is the right divisor', () => {
    expect(codes(v)).not.toContain('gst_arithmetic');
    expect(Number(expectedGst('1110000', '0', ID_2026))).toBe(110_000);
    // And the Australian answer, for contrast.
    expect(Number(expectedGst('1110000'))).toBe(100_909.0909);
  });

  it('does not run a checksum Indonesia does not have', () => {
    // An individual's NPWP is their NIK, which carries none. Reporting
    // "invalid" would be asserting a check that never happened.
    expect(codes(v)).not.toContain('supplier_abn_invalid');
  });

  it('does not treat IDR as foreign', () => {
    expect(codes(v)).not.toContain('foreign_currency');
  });

  it('prints amounts in rupiah, not dollars', () => {
    const wrong = validate(
      indonesianDocket({ taxAmount: f('90000') }),
      new Date('2026-09-17'),
      ID_2026,
    );
    const finding = wrong.findings.find((x) => x.code === 'gst_arithmetic');
    expect(finding?.message).toMatch(/Rp/);
    expect(finding?.message).not.toMatch(/\$/);
    expect(finding?.message).toMatch(/PPN/);
  });

  it('refuses to call it a valid tax invoice, because the paper cannot say', () => {
    // A faktur pajak is valid only once DJP has cleared it and the seller has
    // uploaded it by the 20th of the following month. Neither fact is on the
    // document, so a clean read is not evidence of validity.
    // docs/INDONESIA.md §4.2.
    expect(v.isTaxInvoice).toBe(false);
    expect(validate(indonesianDocket(), new Date('2026-09-17')).isTaxInvoice).toBe(false);
  });
});

describe('PB1 — the confident-wrong tax line', () => {
  it('names the other tax when the arithmetic does not fit PPN', () => {
    // A restaurant bill: Rp 200,000 subtotal, Rp 20,000 PB1 at 10%. Read as
    // PPN that is Rp ~1,800 short of 11/111 — a gap small enough to look like
    // a rounding complaint rather than the category error it is.
    const v = validate(
      indonesianDocket({
        payableAmount: f('220000'),
        taxAmount: f('20000'),
        taxExclusiveAmount: f('200000'),
      }),
      new Date('2026-09-17'),
      ID_2026,
    );
    const finding = v.findings.find((x) => x.code === 'gst_arithmetic');
    expect(finding).toBeDefined();
    expect(finding!.message).toMatch(/PB1/);
    expect(finding!.fix).toMatch(/never recoverable/i);
  });
});

describe('retention and periods follow the jurisdiction', () => {
  it('accepts an 8-year-old document Australia would refuse', () => {
    // Indonesia requires records kept 10 years (UU KUP Pasal 28(11)), so an
    // 8-year-old docket is one the taxpayer is still legally required to hold.
    const today = new Date('2026-09-17');
    expect(dateProblem('2018-06-01', today, 7)?.code).toBe('date_implausible');
    expect(dateProblem('2018-06-01', today, 12)).toBeNull();
  });

  it('groups by tax year, so an ambiguous date inside one year is not raised', () => {
    // Australia reports quarterly, so 06/09 vs 09/06 straddles two BAS
    // quarters and must be confirmed. A personal Indonesian taxpayer files no
    // consumption-tax return at all, so both readings land in the same period
    // and interrupting would cost more than it saves.
    expect(periodKey('2026-06-09')).not.toBe(periodKey('2026-09-06'));
    expect(periodKey('2026-06-09', ID_2026)).toBe(periodKey('2026-09-06', ID_2026));

    const v = validate(
      indonesianDocket({ issueDate: f('2026-06-09') }),
      new Date('2026-09-17'),
      ID_2026,
    );
    expect(codes(v)).not.toContain('date_order_ambiguous');
  });
});
