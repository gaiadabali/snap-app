import { describe, expect, it } from 'vitest';

import { consumptionTaxFromRules, toWire } from './documents.controller.js';

const wire = (row: Record<string, unknown>) =>
  toWire(
    { id: 'd', capture_id: 'c', tenant_id: 't', currency: 'AUD', is_tax_invoice: false, review_status: 'needs_review', ...row } as never,
    [],
    [],
    consumptionTaxFromRules(null),
  );

describe('toWire: the ex-tax total', () => {
  it('keeps the stored ex-tax total when the receipt printed one', () => {
    expect(wire({ payable_amount: '110.0000', tax_amount: '10.0000', tax_exclusive_amount: '100.0000' }).taxExclusiveAmount).toBe('100.0000');
  });

  it('AU receipt with GST and no printed ex-GST total: total less GST, not 0', () => {
    const w = wire({ payable_amount: '31.8000', tax_amount: '2.8900', tax_exclusive_amount: null });
    expect(w.taxExclusiveAmount).toBe('28.9100');
  });

  it('tax unknown: ex-tax stays unknown (null), never the whole total', () => {
    const w = wire({ payable_amount: '8.5000', tax_amount: null, tax_exclusive_amount: null });
    expect(w.taxExclusiveAmount).toBeNull();
    expect(w.taxAmount).toBe('0.0000');
  });

  it('total unknown: ex-tax stays unknown, never negative', () => {
    const w = wire({ payable_amount: null, tax_amount: '2.8900', tax_exclusive_amount: null });
    expect(w.taxExclusiveAmount).toBeNull();
  });

  it('receipt that says GST 0: ex-tax is the total', () => {
    expect(wire({ payable_amount: '8.5000', tax_amount: '0.0000', tax_exclusive_amount: null }).taxExclusiveAmount).toBe('8.5000');
  });
});
