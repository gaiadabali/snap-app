import { describe, expect, it } from 'vitest';

import { buildGstReport, quarterRange, resolveRange, type GstReportRow } from './gst-report.js';

const doc = (number: number, kind: string, total: number, gst: number | null, issued: string, original: number | null = null): GstReportRow => ({
  section: 'documents', number, kind, total_cents: total, gst_cents: gst, issued_at: issued, original_number: original, ref: null,
});

describe('Australian quarters (named by the financial year ending 30 June)', () => {
  it('maps each quarter to its months', () => {
    expect(quarterRange('FY2026-Q1')).toEqual({ from: '2025-07-01', to: '2025-09-30' });
    expect(quarterRange('FY2026-Q2')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(quarterRange('FY2026-Q3')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quarterRange('FY2026-Q4')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('refuses what is not a quarter, and a bad or backwards range', () => {
    expect(quarterRange('2026-Q2')).toBeNull();
    expect(quarterRange('FY2026-Q5')).toBeNull();
    expect(resolveRange({ from: '2026-02-31', to: '2026-03-01' })).toBeNull();
    expect(resolveRange({ from: '2026-03-02', to: '2026-03-01' })).toBeNull();
    expect(resolveRange({})).toBeNull();
    expect(resolveRange({ from: '2026-01-01', to: '2026-03-31' })).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
});

describe('the GST report CSV', () => {
  const rows: GstReportRow[] = [
    doc(1, 'tax_invoice', 500, 45, '2025-10-02T01:00:00.000Z'),
    doc(2, 'tax_invoice', 3700, 336, '2025-10-20T01:00:00.000Z'),
    doc(3, 'adjustment_note', -500, -45, '2025-11-01T01:00:00.000Z', 1),
    { section: 'google', number: null, issued_at: '2025-11-05T01:00:00.000Z', kind: 'play_sale', original_number: null, total_cents: 1850, gst_cents: null, ref: 'pur-1' },
  ];
  const report = buildGstReport({ from: '2025-10-01', to: '2025-12-31' }, rows, new Date('2026-01-02T00:00:00Z'));
  const lines = report.csv.trimEnd().split('\r\n');

  it('has the columns document number, date, kind, net, GST, total, refund refs', () => {
    expect(lines).toContain('Document number,Date,Kind,Net,GST,Total,Refund refs');
  });

  it('lists each document with net, GST and total, and the refund naming its original', () => {
    expect(lines).toContain('SNAP-000001,2025-10-02,Tax invoice,4.55,0.45,5.00,');
    expect(lines).toContain('SNAP-000002,2025-10-20,Tax invoice,33.64,3.36,37.00,');
    expect(lines).toContain('SNAP-000003,2025-11-01,Adjustment note,-4.55,-0.45,-5.00,SNAP-000001');
  });

  it('totals sales, GST collected and refunds', () => {
    expect(report.totals).toMatchObject({
      salesCents: 4200,
      salesGstCents: 381,
      refundsCents: -500,
      refundsGstCents: -45,
      documentCount: 3,
    });
    expect(lines).toContain('Sales,,,38.19,3.81,42.00,');
    expect(lines).toContain('GST collected,,,,3.81,,');
    expect(lines).toContain('Refunds,,,-4.55,-0.45,-5.00,');
    expect(lines).toContain('Net after refunds,,,33.64,3.36,37.00,');
  });

  it('keeps Google Play sales apart, marked GST paid by Google, and out of the totals', () => {
    const at = lines.findIndex((l) => l.startsWith('Google Play sales: GST paid by Google'));
    expect(at).toBeGreaterThan(lines.indexOf('Net after refunds,,,33.64,3.36,37.00,'));
    expect(lines[at + 2]).toBe('pur-1,2025-11-05,Play sale,,GST paid by Google,18.50,');
    expect(report.totals.playSalesCents).toBe(1850);
    expect(report.totals.salesCents).toBe(4200);
  });

  it('a receipt-only period shows zero GST', () => {
    const r = buildGstReport({ from: '2025-10-01', to: '2025-10-31' }, [doc(1, 'receipt', 500, null, '2025-10-02T01:00:00.000Z')], new Date());
    expect(r.csv).toContain('SNAP-000001,2025-10-02,Receipt,5.00,0.00,5.00,');
    expect(r.totals.salesGstCents).toBe(0);
  });

  it('names the file by its range', () => {
    expect(report.filename).toBe('snap-gst-2025-10-01-to-2025-12-31.csv');
  });
});
