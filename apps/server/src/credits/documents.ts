import type { CreditDocument, CreditDocumentKind, CreditDocumentRef } from '@snap/api-contract';

import { formatAbn } from './abn.js';

/**
 * The words on a credit receipt or tax invoice (7.7.b), in one place.
 *
 * The database decides WHICH document a purchase gets, takes the number and
 * stores the cents (migration 0059). This file only turns a stored row into
 * what a person reads, so the website and the phone show the same text.
 *
 * Money is integer cents. GST is 1/11 of the GST-inclusive total, rounded to
 * the cent.
 */

export const DOCUMENT_TITLE: Record<CreditDocumentKind, string> = {
  tax_invoice: 'Tax invoice',
  receipt: 'Receipt',
  adjustment_note: 'Adjustment note',
  refund_receipt: 'Refund receipt',
};

/** Said in the purchase history of a Google Play purchase, which gets no document from us. */
export const PLAY_RECEIPT_NOTE = 'Google issues the receipt for this purchase';

export type CreditDocumentRow = {
  id: string;
  purchase_id: string;
  direction: 'sale' | 'refund';
  kind: CreditDocumentKind;
  /** bigint arrives as a string from pg. */
  number: string | number;
  issued_at: string;
  original_number: string | number | null;
  pack_code: string;
  credits: number;
  total_cents: string | number;
  gst_cents: string | number | null;
  issuer: { legalName: string; abn: string | null; address: string; email: string } | null;
  buyer_name: string;
  buyer_email: string | null;
  provider: string;
};

/** SNAP-000123: the gap-free number as shown. */
export function documentNumber(n: string | number): string {
  return `SNAP-${String(n).padStart(6, '0')}`;
}

/** The GST in a GST-inclusive total (cents): an eleventh, rounded to the cent. A$5.00 -> A$0.45. */
export function gstInTotalCents(totalCents: number): number {
  const sign = totalCents < 0 ? -1 : 1;
  // abs/11 never ends in .5 (11 is odd), so half-up is simply nearest.
  return sign * Math.floor((Math.abs(totalCents) + 5) / 11);
}

/** 500 -> "A$5.00"; -45 -> "-A$0.45". */
export function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  const text = `A$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** Cents as a plain decimal for a spreadsheet: -45 -> "-0.45". */
export function decimalCents(cents: number): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** "11 Nov 2026" in Sydney, where the business is. */
export function formatIssuedOn(iso: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
    .format(new Date(iso))
    .replace(/ /g, ' ');
}

/** The Sydney calendar date, YYYY-MM-DD (en-CA formats that way). */
export function sydneyDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(iso));
}

export function toCreditDocumentRef(
  row: Pick<CreditDocumentRow, 'id' | 'number' | 'kind' | 'issued_at'>,
): CreditDocumentRef {
  return {
    id: row.id,
    number: documentNumber(row.number),
    kind: row.kind,
    title: DOCUMENT_TITLE[row.kind],
    issuedAt: new Date(row.issued_at).toISOString(),
  };
}

export function toCreditDocument(row: CreditDocumentRow): CreditDocument {
  const total = Number(row.total_cents);
  const gst = row.gst_cents === null ? null : Number(row.gst_cents);
  const taxKind = row.kind === 'tax_invoice' || row.kind === 'adjustment_note';
  const original = row.original_number === null ? null : documentNumber(row.original_number);

  // The ABN and the GST line appear on a tax invoice or adjustment note ONLY.
  // A receipt never carries them, whatever is stored.
  const issuer = row.issuer
    ? {
        legalName: row.issuer.legalName,
        abn: taxKind && row.issuer.abn ? formatAbn(row.issuer.abn) : null,
        address: row.issuer.address,
        email: row.issuer.email,
      }
    : null;

  let gstStatement: string | null = null;
  if (taxKind && gst !== null) {
    gstStatement =
      row.kind === 'tax_invoice'
        ? `Total includes GST of ${formatCents(gst)}`
        : `Total includes GST adjustment of ${formatCents(gst)}`;
  }

  let reference: string | null = null;
  if (row.direction === 'refund' && original) {
    reference =
      row.kind === 'adjustment_note' ? `Adjusts tax invoice ${original}` : `Refund of receipt ${original}`;
  }

  return {
    id: row.id,
    purchaseId: row.purchase_id,
    number: documentNumber(row.number),
    kind: row.kind,
    title: DOCUMENT_TITLE[row.kind],
    issuedOn: formatIssuedOn(row.issued_at),
    issuedAt: new Date(row.issued_at).toISOString(),
    issuer,
    buyer: { name: row.buyer_name, email: row.buyer_email },
    item: {
      description: `Credit pack: ${row.credits} scans`,
      quantity: 1,
      amount: formatCents(total),
    },
    gstStatement,
    total: formatCents(total),
    reference,
    note: row.provider === 'stripe' ? 'Paid by card online.' : '',
  };
}
