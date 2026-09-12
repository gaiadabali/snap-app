import { describe, expect, it } from 'vitest';

import type { Extraction, ExtractedLine } from './types.js';
import {
  abnIsValid,
  ambiguousDateOrder,
  dateProblem,
  expectedGst,
  linesGap,
  quarterOf,
  validate,
} from './validators.js';

/**
 * The deterministic half of extraction.
 *
 * Written against the failures a real vision model actually produced when I
 * tested one on a photographed docket, not against imagined ones:
 *
 *   - It read `06/09/26` as the year **2006**. Perfectly formed, perfectly
 *     wrong, and invisible in any UI that just displays what it was given.
 *   - It is fluent enough to return a plausible ABN with one digit off, which
 *     no amount of prompting fixes and a checksum catches every time.
 *
 * Both are decidable in code, so the model is never trusted for either.
 */

const NOW = new Date(2026, 8, 10); // 10 September 2026

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

function line(description: string, amount: string, gstFree = false): ExtractedLine {
  return {
    description: f(description),
    quantity: f(1),
    unitPrice: f(amount),
    amount: f(amount),
    gstFree: f(gstFree),
  };
}

/** A clean, compliant tax invoice: $266.91 incl, GST exactly 1/11. */
function good(over: Partial<Extraction> = {}): Extraction {
  return {
    schemaVersion: '1',
    docType: f('tax_invoice' as const),
    saysTaxInvoice: f(true),
    documentNumber: f('88214'),
    // The 24th of last month: in the past, and unambiguous because there is
    // no 24th month. A date like 2026-09-06 is a different case with its own
    // tests below.
    issueDate: f('2026-08-24'),
    currency: f('AUD'),
    supplierName: f('BP Truckstop Gundagai'),
    supplierAbn: f('33051775556'),
    buyerIdentified: f(true),
    taxExclusiveAmount: f('242.65'),
    taxAmount: f('24.26'),
    payableAmount: f('266.91'),
    lines: [line('Diesel', '243.91'), line('AdBlue 10L', '18.50'), line('Coffee', '4.50')],
    notes: { legible: true, imageIssues: [], warnings: [] },
    ...over,
  };
}

describe('ABN checksum', () => {
  it('accepts real ABNs', () => {
    expect(abnIsValid('33051775556')).toBe(true);
    expect(abnIsValid('51 824 753 556')).toBe(true);
  });

  it('rejects one transposed digit', () => {
    // The exact class of error a model makes on a faded thermal print.
    expect(abnIsValid('33051775565')).toBe(false);
  });

  it('rejects the wrong length and empty values', () => {
    expect(abnIsValid('3305177555')).toBe(false);
    expect(abnIsValid('')).toBe(false);
    expect(abnIsValid(null)).toBe(false);
  });
});

describe('date plausibility', () => {
  it('accepts a recent date', () => {
    expect(dateProblem('2026-09-06', NOW)).toBeNull();
    expect(dateProblem('2024-01-15', NOW)).toBeNull();
  });

  it('catches the two-digit-year misread', () => {
    // This is the real one: 06/09/26 became 2006-09-26.
    expect(dateProblem('2006-09-26', NOW)?.code).toBe('date_implausible');
  });

  it('refuses a future date', () => {
    expect(dateProblem('2027-01-01', NOW)?.code).toBe('date_future');
  });

  it('tolerates a device clock slightly ahead', () => {
    // Tomorrow is allowed: an evening purchase with a fast clock is not an error.
    expect(dateProblem('2026-09-11', NOW)).toBeNull();
  });

  it('rejects nonsense and nulls', () => {
    expect(dateProblem('06/09/2026', NOW)?.code).toBe('date_malformed');
    expect(dateProblem('2026-13-45', NOW)?.code).toBe('date_malformed');
    expect(dateProblem(null, NOW)?.code).toBe('date_missing');
  });
});

describe('day/month ambiguity', () => {
  it('flags a date both readings could produce, and offers the other one', () => {
    // The real failure: a docket printed 06/09/26 came back as 2026-06-09 on
    // one run and 2006-09-26 on another, having been told twice that
    // Australian dates are day-first.
    expect(ambiguousDateOrder('2026-06-09')).toEqual({ alternative: '2026-09-06' });
  });

  it('leaves an unambiguous date alone', () => {
    // The 13th onwards can only be a day, which is most of the month.
    expect(ambiguousDateOrder('2026-09-24')).toBeNull();
    expect(ambiguousDateOrder('2026-12-25')).toBeNull();
  });

  it('is not ambiguous when the two numbers are the same', () => {
    expect(ambiguousDateOrder('2026-07-07')).toBeNull();
  });

  it('stops the document rather than guessing the quarter', () => {
    // 9 June and 6 September are different quarters, so this is the wrong BAS
    // if it is wrong — and no plausibility check can tell.
    const r = validate(good({ issueDate: f('2026-06-09') }), NOW);
    const finding = r.findings.find((x) => x.code === 'date_order_ambiguous');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('2026-09-06');
    expect(r.reviewStatus).toBe('needs_review');
  });

  it('says nothing when both readings are in the same quarter', () => {
    // 5 June and 6 May are both in the Apr-Jun quarter, so no report differs
    // and there is nothing worth interrupting anyone for.
    const r = validate(good({ issueDate: f('2026-06-05') }), NOW);
    expect(r.findings.some((x) => x.code === 'date_order_ambiguous')).toBe(false);
  });

  it('groups dates into Australian BAS quarters', () => {
    expect(quarterOf('2026-09-06')).toBe('2026-Q3');
    expect(quarterOf('2026-06-09')).toBe('2026-Q2');
    expect(quarterOf('2026-01-31')).toBe('2026-Q1');
    expect(quarterOf('2026-12-01')).toBe('2026-Q4');
  });

  it('does not double up on a date that is already an error', () => {
    // An implausible date is reported once, as an error, not also as ambiguous.
    const r = validate(good({ issueDate: f('2006-09-06') }), NOW);
    expect(r.findings.filter((x) => x.field === 'issueDate')).toHaveLength(1);
  });
});

describe('GST arithmetic', () => {
  it('is 1/11 of the inclusive amount, not 10% of it', () => {
    // 10% of $266.91 would be $26.69 — over-stating the tax by $2.43.
    expect(Number(expectedGst('266.91'))).toBeCloseTo(24.2645, 3);
    expect(Number(expectedGst('110.00'))).toBeCloseTo(10, 4);
  });

  it('excludes a GST-free portion', () => {
    expect(Number(expectedGst('84.20', '41.60'))).toBeCloseTo(3.8727, 3);
  });
});

describe('a clean tax invoice', () => {
  const result = validate(good(), NOW);

  it('is a valid tax invoice', () => {
    expect(result.isTaxInvoice).toBe(true);
    expect(result.complianceFailures).toEqual([]);
  });

  it('has nothing at risk', () => {
    expect(result.gstAtRisk).toBeNull();
  });

  it('is accepted without a human', () => {
    expect(result.findings).toEqual([]);
    expect(result.reviewStatus).toBe('auto_accepted');
  });
});

describe('what stops a document', () => {
  it('an implausible date is an error, not a warning', () => {
    const r = validate(good({ issueDate: f('2006-09-06') }), NOW);
    expect(r.findings.find((x) => x.field === 'issueDate')?.severity).toBe('error');
    expect(r.reviewStatus).toBe('needs_review');
  });

  it('an illegible image stops it', () => {
    const r = validate(
      good({ notes: { legible: false, imageIssues: ['glare across the total'], warnings: [] } }),
      NOW,
    );
    expect(r.findings.some((x) => x.code === 'illegible' && x.severity === 'error')).toBe(true);
    expect(r.reviewStatus).toBe('needs_review');
  });

  it('a missing total stops it', () => {
    const r = validate(good({ payableAmount: f(null) }), NOW);
    expect(r.findings.some((x) => x.code === 'total_missing')).toBe(true);
  });

  it('low confidence on a critical field asks for a human', () => {
    const r = validate(good({ payableAmount: f('266.91', 0.6) }), NOW);
    expect(r.findings.some((x) => x.code === 'low_confidence')).toBe(true);
    expect(r.reviewStatus).toBe('needs_review');
    expect(r.confidenceOverall).toBeCloseTo(0.6);
  });
});

describe('GST that does not reconcile', () => {
  it('is flagged when the model misreads the tax', () => {
    // 10% of the inclusive total instead of 1/11: the classic error.
    const r = validate(good({ taxAmount: f('26.69') }), NOW);
    const finding = r.findings.find((x) => x.code === 'gst_arithmetic');
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('24.26');
  });

  it('accepts a cent of till rounding', () => {
    const r = validate(good({ taxAmount: f('24.27') }), NOW);
    expect(r.findings.some((x) => x.code === 'gst_arithmetic')).toBe(false);
  });

  it('does not flag a basket that is partly GST-free', () => {
    // $84.20 with $41.60 of fresh food: GST is 1/11 of the taxable part only.
    const r = validate(
      good({
        payableAmount: f('84.20'),
        taxAmount: f('3.87'),
        buyerIdentified: f(false),
        lines: [line('Hot food', '42.60'), line('Fresh fruit', '41.60', true)],
      }),
      NOW,
    );
    expect(r.findings.some((x) => x.code === 'gst_arithmetic')).toBe(false);
  });
});

describe('lines against the total', () => {
  it('notices a missed line', () => {
    const r = validate(
      good({ lines: [line('Diesel', '243.91'), line('AdBlue 10L', '18.50')] }),
      NOW,
    );
    const finding = r.findings.find((x) => x.code === 'lines_do_not_balance');
    expect(finding?.message).toContain('4.50');
    expect(finding?.fix).toContain('missed');
  });

  it('notices a line read twice', () => {
    const r = validate(
      good({ lines: [...good().lines, line('Coffee', '4.50')] }),
      NOW,
    );
    expect(r.findings.find((x) => x.code === 'lines_do_not_balance')?.fix).toContain('twice');
  });

  it('says nothing when no lines were read at all', () => {
    // Absent lines are a limitation, not a discrepancy.
    const r = validate(good({ lines: [] }), NOW);
    expect(r.findings.some((x) => x.code === 'lines_do_not_balance')).toBe(false);
  });

  /**
   * The case that a real two-page invoice exposed.
   *
   * A commercial tax invoice prints its lines EX-GST and shows the GST once at
   * the bottom, so the lines are short of the payable total by exactly the GST
   * — which the check used to report as a missed line. It fired on a 40-line
   * invoice the model had read perfectly, and it would have fired on virtually
   * every supplier invoice, which is how a reviewer learns to ignore warnings.
   */
  it('accepts ex-GST lines on a commercial tax invoice', () => {
    // $15,926.65 ex + $1,592.66 GST = $17,519.31 incl. The shape of the real
    // document from the Phase 0 gate, with the 40 lines collapsed to two.
    const r = validate(
      good({
        lines: [line('Line haul Melbourne–Sydney', '15000.00'), line('Fuel levy', '926.65')],
        taxAmount: f('1592.66'),
        taxExclusiveAmount: f('15926.65'),
        payableAmount: f('17519.31'),
      }),
      NOW,
    );
    expect(r.findings.some((x) => x.code === 'lines_do_not_balance')).toBe(false);
  });

  it('still accepts GST-inclusive lines on a retail docket', () => {
    // The other convention, which must keep working: the lines already carry
    // the GST, so they sum to the total rather than to the total minus GST.
    const r = validate(good(), NOW);
    expect(r.findings.some((x) => x.code === 'lines_do_not_balance')).toBe(false);
  });

  it('still catches a genuine imbalance on an ex-GST invoice', () => {
    // Neither reading works: $15,000 + $926.65 GST-exclusive would be
    // $15,926.65, so a line worth $1,000 is genuinely missing.
    const r = validate(
      good({
        lines: [line('Line haul Melbourne–Sydney', '14000.00'), line('Fuel levy', '926.65')],
        taxAmount: f('1592.66'),
        taxExclusiveAmount: f('15926.65'),
        payableAmount: f('17519.31'),
      }),
      NOW,
    );
    expect(r.findings.some((x) => x.code === 'lines_do_not_balance')).toBe(true);
  });
});

describe('linesGap', () => {
  it('prefers whichever reading the document actually used', () => {
    // Ex-GST lines: the exclusive reading is exact, so that is the gap.
    expect(linesGap(15926.65, '17519.31', '1592.66')).toBeCloseTo(0, 2);
    // Inclusive lines: the inclusive reading is exact.
    expect(linesGap(17519.31, '17519.31', '1592.66')).toBeCloseTo(0, 2);
  });

  it('falls back to the inclusive reading when no GST is stated', () => {
    // With no GST there is only one reading, and a real shortfall must show.
    expect(linesGap(100, '110', null)).toBeCloseTo(10, 2);
  });

  it('keeps the sign, so the message can say short or over', () => {
    expect(linesGap(90, '100', null)).toBeGreaterThan(0);
    expect(linesGap(110, '100', null)).toBeLessThan(0);
  });
});

describe('the ATO tax-invoice elements', () => {
  it('fails without a supplier ABN', () => {
    const r = validate(good({ supplierAbn: f(null) }), NOW);
    expect(r.complianceFailures).toContain('supplier_abn_missing');
    expect(r.isTaxInvoice).toBe(false);
    expect(r.gstAtRisk).toBe('24.26');
  });

  it('fails on an ABN that does not checksum', () => {
    const r = validate(good({ supplierAbn: f('33051775565') }), NOW);
    expect(r.complianceFailures).toContain('supplier_abn_invalid');
    expect(r.findings.find((x) => x.code === 'supplier_abn_invalid')?.message).toContain(
      'misread',
    );
  });

  it('requires the buyer to be identified at $1,000 or more', () => {
    const r = validate(
      good({ payableAmount: f('1848.00'), taxAmount: f('168.00'), buyerIdentified: f(false), lines: [] }),
      NOW,
    );
    expect(r.complianceFailures).toContain('buyer_abn_required_over_1000');
  });

  it('does not require it below $1,000', () => {
    const r = validate(good({ buyerIdentified: f(false) }), NOW);
    expect(r.complianceFailures).not.toContain('buyer_abn_required_over_1000');
  });

  it('fails when the words “tax invoice” are absent', () => {
    const r = validate(good({ saysTaxInvoice: f(false) }), NOW);
    expect(r.complianceFailures).toContain('not_marked_tax_invoice');
  });

  it('softens the wording under $82.50, where no tax invoice is required', () => {
    const r = validate(
      good({
        payableAmount: f('8.50'),
        taxAmount: f('0.77'),
        saysTaxInvoice: f(false),
        supplierAbn: f(null),
        lines: [line('Flat white', '5.50'), line('Banana bread', '3.00')],
      }),
      NOW,
    );
    expect(r.belowTaxInvoiceThreshold).toBe(true);
    // Still not a valid tax invoice, but nothing here is the user's mistake,
    // so it reads as a note rather than a warning.
    expect(r.isTaxInvoice).toBe(false);
    expect(r.findings.find((x) => x.code === 'not_marked_tax_invoice')?.severity).toBe('note');
    expect(r.findings.find((x) => x.code === 'supplier_abn_missing')?.severity).toBe('note');
  });

  it('flags a foreign currency', () => {
    const r = validate(good({ currency: f('USD') }), NOW);
    expect(r.findings.some((x) => x.code === 'foreign_currency')).toBe(true);
  });
});

describe('replayability', () => {
  it('is a pure function of the extraction and the clock', () => {
    const a = validate(good(), NOW);
    const b = validate(good(), NOW);
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
    expect(a.reviewStatus).toBe(b.reviewStatus);
  });
});
