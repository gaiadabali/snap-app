import { describe, expect, it } from 'vitest';

import {
  documentNumber,
  formatCents,
  gstInTotalCents,
  toCreditDocument,
  type CreditDocumentRow,
} from './documents.js';
import { toPurchase } from './credits.controller.js';

const ISSUER = {
  legalName: 'Snap Apps Pty Ltd',
  abn: '51824753556',
  address: '1 George St\nSydney NSW 2000',
  email: 'billing@snap.test',
  gstRegistered: true,
};

function row(over: Partial<CreditDocumentRow>): CreditDocumentRow {
  return {
    id: 'd1',
    purchase_id: 'p1',
    direction: 'sale',
    kind: 'tax_invoice',
    number: '7',
    issued_at: '2026-11-11T02:00:00.000Z',
    original_number: null,
    pack_code: 'credits_100',
    credits: 100,
    total_cents: '500',
    gst_cents: '45',
    issuer: ISSUER,
    buyer_name: 'Jo Citizen',
    buyer_email: 'jo@example.test',
    provider: 'stripe',
    ...over,
  };
}

describe('GST maths: an eleventh of the GST-inclusive total, to the cent', () => {
  it('A$5.00 includes A$0.45', () => {
    expect(gstInTotalCents(500)).toBe(45);
    expect(formatCents(gstInTotalCents(500))).toBe('A$0.45');
  });

  it('rounds to the nearest cent and never leaves the total', () => {
    // 185 / 11 = 16.8181..., 3700 / 11 = 336.36..., 1 / 11 = 0.09..., 6 / 11 = 0.54...
    expect(gstInTotalCents(185)).toBe(17);
    expect(gstInTotalCents(3700)).toBe(336);
    expect(gstInTotalCents(1)).toBe(0);
    expect(gstInTotalCents(6)).toBe(1);
    for (let t = 0; t <= 5000; t += 1) {
      expect(Math.abs(gstInTotalCents(t) - t / 11)).toBeLessThan(0.5);
    }
  });

  it('a refund is the same GST with the sign turned', () => {
    expect(gstInTotalCents(-500)).toBe(-45);
    expect(formatCents(-45)).toBe('-A$0.45');
  });
});

describe('a tax invoice', () => {
  const doc = toCreditDocument(row({}));

  it('says Tax invoice, with the issuer, the ABN, the date, the buyer, the pack and the price', () => {
    expect(doc.title).toBe('Tax invoice');
    expect(doc.number).toBe('SNAP-000007');
    expect(doc.issuer).toEqual({
      legalName: 'Snap Apps Pty Ltd',
      abn: '51 824 753 556',
      address: '1 George St\nSydney NSW 2000',
      email: 'billing@snap.test',
    });
    expect(doc.issuedOn).toBe('11 Nov 2026');
    expect(doc.buyer).toEqual({ name: 'Jo Citizen', email: 'jo@example.test' });
    expect(doc.item).toEqual({ description: 'Credit pack: 100 scans', quantity: 1, amount: 'A$5.00' });
    expect(doc.total).toBe('A$5.00');
  });

  it('states the GST it includes, A$0.45 on A$5.00', () => {
    expect(doc.gstStatement).toBe('Total includes GST of A$0.45');
  });
});

describe('a receipt', () => {
  // The database stores an issuer snapshot (with its ABN) on a receipt too, so this
  // is the test that the words never carry it.
  const doc = toCreditDocument(row({ kind: 'receipt', gst_cents: null }));

  it('says Receipt, and has no ABN line and no GST statement at all', () => {
    expect(doc.title).toBe('Receipt');
    expect(doc.issuer?.abn).toBeNull();
    expect(doc.gstStatement).toBeNull();
    expect(JSON.stringify(doc)).not.toMatch(/ABN|GST|824/);
  });

  it('copes with no issuer approved yet', () => {
    const none = toCreditDocument(row({ kind: 'receipt', gst_cents: null, issuer: null }));
    expect(none.issuer).toBeNull();
    expect(none.gstStatement).toBeNull();
  });
});

describe('refunds', () => {
  it('an adjustment note carries the negative amount and GST, and names the tax invoice', () => {
    const doc = toCreditDocument(
      row({ direction: 'refund', kind: 'adjustment_note', number: '8', original_number: '7', total_cents: '-500', gst_cents: '-45' }),
    );
    expect(doc.title).toBe('Adjustment note');
    expect(doc.total).toBe('-A$5.00');
    expect(doc.gstStatement).toBe('Total includes GST adjustment of -A$0.45');
    expect(doc.reference).toBe('Adjusts tax invoice SNAP-000007');
    expect(doc.issuer?.abn).toBe('51 824 753 556');
  });

  it('a refund receipt carries the negative amount, names the receipt, and has no ABN or GST', () => {
    const doc = toCreditDocument(
      row({ direction: 'refund', kind: 'refund_receipt', number: '9', original_number: '4', total_cents: '-500', gst_cents: null }),
    );
    expect(doc.title).toBe('Refund receipt');
    expect(doc.total).toBe('-A$5.00');
    expect(doc.reference).toBe('Refund of receipt SNAP-000004');
    expect(doc.issuer?.abn).toBeNull();
    expect(doc.gstStatement).toBeNull();
  });
});

describe('numbers', () => {
  it('are shown as SNAP- and six digits', () => {
    expect(documentNumber('1')).toBe('SNAP-000001');
    expect(documentNumber(1234567)).toBe('SNAP-1234567');
  });
});

describe('the purchase history', () => {
  const base = {
    id: 'p1', pack_code: 'credits_100', credits: 100, price_aud: '5.0000', status: 'paid' as const,
    created_at: '2026-11-11T02:00:00.000Z', paid_at: '2026-11-11T02:01:00.000Z',
  };

  it('links the documents of a Stripe purchase and adds no note', () => {
    const p = toPurchase({ ...base, provider: 'stripe', documents: [{ id: 'd1', number: '7', kind: 'receipt', issued_at: '2026-11-11T02:01:00.000Z' }] });
    expect(p.documents).toEqual([
      { id: 'd1', number: 'SNAP-000007', kind: 'receipt', title: 'Receipt', issuedAt: '2026-11-11T02:01:00.000Z' },
    ]);
    expect(p.receiptNote).toBeNull();
  });

  it('says Google issues the receipt for a Play purchase, and shows no document', () => {
    const p = toPurchase({ ...base, provider: 'google', documents: [] });
    expect(p.documents).toEqual([]);
    expect(p.receiptNote).toBe('Google issues the receipt for this purchase');
  });
});
