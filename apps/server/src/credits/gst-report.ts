import type { GstReport } from '@snap/api-contract';

import { DOCUMENT_TITLE, decimalCents, documentNumber, sydneyDate } from './documents.js';

/**
 * The quarterly GST export (6.12.b): pure, so the totals are tested without a
 * database. The rows come from `admin_gst_report` (migration 0059).
 *
 * Quarters are the Australian BAS quarters, named by the financial year they
 * fall in, which ends on 30 June: FY2026-Q1 is Jul-Sep 2025, Q2 Oct-Dec 2025,
 * Q3 Jan-Mar 2026, Q4 Apr-Jun 2026. Dates are Sydney dates.
 */

export type GstReportRow = {
  section: 'documents' | 'google';
  number: string | number | null;
  issued_at: string;
  kind: string;
  original_number: string | number | null;
  total_cents: string | number;
  gst_cents: string | number | null;
  ref: string | null;
};

const QUARTER = /^FY(\d{4})-Q([1-4])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "FY2026-Q2" -> 2025-10-01 .. 2025-12-31; null if it is not a quarter. */
export function quarterRange(label: string): { from: string; to: string } | null {
  const m = QUARTER.exec(label);
  if (!m) return null;
  const fy = Number(m[1]);
  switch (m[2]) {
    case '1': return { from: `${fy - 1}-07-01`, to: `${fy - 1}-09-30` };
    case '2': return { from: `${fy - 1}-10-01`, to: `${fy - 1}-12-31` };
    case '3': return { from: `${fy}-01-01`, to: `${fy}-03-31` };
    default: return { from: `${fy}-04-01`, to: `${fy}-06-30` };
  }
}

/** The range a request asks for: a quarter, or an explicit from and to. */
export function resolveRange(q: { quarter?: string; from?: string; to?: string }): { from: string; to: string } | null {
  if (q.quarter) return quarterRange(q.quarter);
  if (q.from && q.to && DATE.test(q.from) && DATE.test(q.to) && q.from <= q.to) {
    // Real dates only: 2025-02-31 is not one.
    for (const d of [q.from, q.to]) if (new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) return null;
    return { from: q.from, to: q.to };
  }
  return null;
}

function csvCell(value: string): string {
  // Ours only (numbers, dates, fixed words), but quote anything unusual.
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

export function buildGstReport(range: { from: string; to: string }, rows: GstReportRow[], generatedAt: Date): GstReport {
  const docs = rows.filter((r) => r.section === 'documents');
  const play = rows.filter((r) => r.section === 'google');

  const sales = docs.filter((r) => Number(r.total_cents) >= 0);
  const refunds = docs.filter((r) => Number(r.total_cents) < 0);
  const sum = (list: GstReportRow[], f: (r: GstReportRow) => number) => list.reduce((t, r) => t + f(r), 0);
  const total = (r: GstReportRow) => Number(r.total_cents);
  const gst = (r: GstReportRow) => (r.gst_cents === null ? 0 : Number(r.gst_cents));

  const totals = {
    salesCents: sum(sales, total),
    salesGstCents: sum(sales, gst),
    refundsCents: sum(refunds, total),
    refundsGstCents: sum(refunds, gst),
    documentCount: docs.length,
    playSalesCents: sum(play, total),
    playSalesCount: play.length,
  };

  const line = (r: GstReportRow, label: string) => {
    const t = total(r);
    const g = gst(r);
    return csvLine([
      label,
      sydneyDate(r.issued_at),
      r.kind === 'play_sale' ? 'Play sale' : (DOCUMENT_TITLE as Record<string, string>)[r.kind] ?? r.kind,
      decimalCents(t - g),
      decimalCents(g),
      decimalCents(t),
      r.original_number === null ? '' : documentNumber(r.original_number),
    ]);
  };

  const out: string[] = [
    csvLine(['Snap Apps GST report']),
    csvLine(['Period', `${range.from} to ${range.to}`, 'Dates in Australia/Sydney. Amounts in AUD, GST included in Total.']),
    csvLine(['Generated', generatedAt.toISOString()]),
    '',
    csvLine(['Document number', 'Date', 'Kind', 'Net', 'GST', 'Total', 'Refund refs']),
    ...docs.map((r) => line(r, r.number === null ? '' : documentNumber(r.number))),
    '',
    csvLine(['Totals', '', '', 'Net', 'GST', 'Total', '']),
    csvLine(['Sales', '', '', decimalCents(totals.salesCents - totals.salesGstCents), decimalCents(totals.salesGstCents), decimalCents(totals.salesCents), '']),
    csvLine(['GST collected', '', '', '', decimalCents(totals.salesGstCents), '', '']),
    csvLine(['Refunds', '', '', decimalCents(totals.refundsCents - totals.refundsGstCents), decimalCents(totals.refundsGstCents), decimalCents(totals.refundsCents), '']),
    csvLine([
      'Net after refunds', '', '',
      decimalCents(totals.salesCents - totals.salesGstCents + totals.refundsCents - totals.refundsGstCents),
      decimalCents(totals.salesGstCents + totals.refundsGstCents),
      decimalCents(totals.salesCents + totals.refundsCents),
      '',
    ]),
    '',
    csvLine(['Google Play sales: GST paid by Google (not in the totals above)']),
    csvLine(['Reference', 'Date', 'Kind', 'Net', 'GST', 'Total', 'Refund refs']),
    ...play.map((r) => {
      const t = total(r);
      return csvLine([r.ref ?? '', sydneyDate(r.issued_at), 'Play sale', '', 'GST paid by Google', decimalCents(t), '']);
    }),
    csvLine(['Play total', '', '', '', 'GST paid by Google', decimalCents(totals.playSalesCents), '']),
  ];

  return {
    from: range.from,
    to: range.to,
    filename: `snap-gst-${range.from}-to-${range.to}.csv`,
    csv: `${out.join('\r\n')}\r\n`,
    totals,
  };
}
