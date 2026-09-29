import { describe, expect, it } from 'vitest';

import { isoFromPrinted, reconcileIssueDate } from './printed-date.js';
import type { Extraction } from './types.js';

describe('isoFromPrinted', () => {
  it('reads an ambiguous numeric date by the country rule — the Glen Hotel folio', () => {
    // Printed "10-08-19" on a Brisbane folio; the model returned 2019-10-08.
    expect(isoFromPrinted('10-08-19', 'day_first')).toBe('2019-08-10');
    expect(isoFromPrinted('10-08-19', 'month_first')).toBe('2019-10-08');
  });

  it('lets the printed evidence win over the country rule when only one reading exists', () => {
    // A US-printed docket in an Australian workspace: 26 cannot be a month.
    expect(isoFromPrinted('7/26/2019', 'day_first')).toBe('2019-07-26');
    expect(isoFromPrinted('26/07/2019', 'month_first')).toBe('2019-07-26');
  });

  it('accepts the separators dockets actually use', () => {
    expect(isoFromPrinted('03/04/2026', 'day_first')).toBe('2026-04-03');
    expect(isoFromPrinted('03.04.26', 'day_first')).toBe('2026-04-03');
    expect(isoFromPrinted('3 4 2026', 'day_first')).toBe('2026-04-03');
    expect(isoFromPrinted('13/09/19 13:26', 'day_first')).toBe('2019-09-13');
  });

  it('declines anything that is not a plain numeric date, leaving it to the model', () => {
    expect(isoFromPrinted('28 August 2019', 'day_first')).toBeNull();
    expect(isoFromPrinted('Fri 7/26/2019 7:10 AM', 'day_first')).toBeNull();
    expect(isoFromPrinted('2019-08-10', 'day_first')).toBeNull();
    expect(isoFromPrinted('', 'day_first')).toBeNull();
  });

  it('refuses an impossible date rather than rolling it over', () => {
    expect(isoFromPrinted('31/02/2026', 'day_first')).toBeNull();
    expect(isoFromPrinted('13/13/2026', 'day_first')).toBeNull();
  });
});

function extraction(issueDate: string | null, printed?: string | null): Extraction {
  const f = <T>(value: T | null) => ({ value, confidence: 0.9 });
  return {
    schemaVersion: 'test',
    docType: f('tax_invoice' as const),
    saysTaxInvoice: f(true),
    documentNumber: f(null),
    issueDate: f(issueDate),
    ...(printed === undefined ? {} : { issueDatePrinted: f(printed) }),
    currency: f('AUD'),
    supplierName: f('The Glen Hotel & Suites'),
    supplierAbn: f('14009743702'),
    buyerIdentified: f(false),
    taxExclusiveAmount: f(null),
    taxAmount: f('2.64'),
    payableAmount: f('29.00'),
    payment: { method: f(null), cardLast4: f(null), cardBrand: f(null) },
    lines: [],
    notes: { legible: true, imageIssues: [], warnings: [] },
  } as Extraction;
}

describe('reconcileIssueDate', () => {
  it('corrects the model and says so', () => {
    const out = reconcileIssueDate(extraction('2019-10-08', '10-08-19'), 'day_first');
    expect(out.issueDate.value).toBe('2019-08-10');
    expect(out.notes.warnings.join(' ')).toMatch(/printed as "10-08-19" read as 2019-08-10/);
  });

  it('leaves an agreeing reading untouched, with no warning', () => {
    const input = extraction('2019-08-10', '10-08-19');
    expect(reconcileIssueDate(input, 'day_first')).toBe(input);
  });

  it('leaves the model alone when nothing was printed to decide on', () => {
    const noField = extraction('2019-10-08');
    const nullField = extraction('2019-10-08', null);
    expect(reconcileIssueDate(noField, 'day_first')).toBe(noField);
    expect(reconcileIssueDate(nullField, 'day_first')).toBe(nullField);
  });

  it('fills a date the model missed when the printed text is clear', () => {
    const out = reconcileIssueDate(extraction(null, '10/08/2019'), 'day_first');
    expect(out.issueDate.value).toBe('2019-08-10');
  });
});
