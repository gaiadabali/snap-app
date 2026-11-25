import { describe, expect, it } from 'vitest';

import { describeSendContents } from './ftr-send';
import { financialYearOf, pickerGroups, taxCategoryHint, workExpenseStatus } from './work-expense';

const cat = (o: Partial<Parameters<typeof pickerGroups>[0][number]> & { name: string }) => ({
  id: o.name, taxLabel: null, engineRowId: null, privateUsePercent: null, active: true, ...o,
});

describe('financialYearOf (AU, 1 Jul to 30 Jun)', () => {
  it.each([
    ['2026-06-30', '2025-26'],
    ['2026-07-01', '2026-27'],
    ['2025-07-01', '2025-26'],
    ['2099-12-31', '2099-00'],
    ['', null],
    [null, null],
  ])('%s -> %s', (d, fy) => expect(financialYearOf(d)).toBe(fy));
});

describe('pickerGroups', () => {
  const all = [
    cat({ name: 'Groceries' }),
    cat({ name: 'Work tools and equipment', taxLabel: 'D5', engineRowId: 'tools' }),
    cat({ name: 'Work car: fuel', taxLabel: 'D1', engineRowId: 'fuelReceiptTotal' }),
    cat({ name: 'Legacy business', taxLabel: 'D5' }),
    cat({ name: 'Rental: agent fees', taxLabel: 'RENTAL', engineRowId: 'mgmtFees', active: false }),
  ];
  it('splits everyday from tax, orders tax by label, hides switched-off ones', () => {
    const g = pickerGroups(all, null);
    expect(g.everyday.map((c) => c.name)).toEqual(['Groceries', 'Legacy business']);
    expect(g.tax.map((c) => c.name)).toEqual(['Work car: fuel', 'Work tools and equipment']);
  });
  it('keeps the current category even when switched off', () => {
    expect(pickerGroups(all, 'Rental: agent fees').tax.map((c) => c.name)).toContain('Rental: agent fees');
  });
});

describe('taxCategoryHint', () => {
  it('uses the ATO label wording', () => {
    expect(taxCategoryHint({ taxLabel: 'D5', engineRowId: 'tools', privateUsePercent: null })).toBe('D5 · Other work-related expenses');
    expect(taxCategoryHint({ taxLabel: 'D5', engineRowId: 'phoneDevices', privateUsePercent: 40 })).toBe(
      'D5 · Other work-related expenses · 40% private use taken off',
    );
  });
  it('prints no label number where the bundle’s numbering is not the ATO’s', () => {
    expect(taxCategoryHint({ taxLabel: 'D12', engineRowId: 'd12', privateUsePercent: null })).toBe('Tax deduction');
    expect(taxCategoryHint({ taxLabel: 'RENTAL', engineRowId: 'repairs', privateUsePercent: null })).toBe('Rental property');
  });
  it('nothing for an everyday category', () => {
    expect(taxCategoryHint({ taxLabel: null, engineRowId: null, privateUsePercent: null })).toBeNull();
  });
});

describe('workExpenseStatus', () => {
  const doc = { taxLabel: 'D5', engineRowId: 'tools', categorySource: 'user' as const, issueDate: '2026-03-02', currency: 'AUD' };
  it('counted, with its year', () => {
    expect(workExpenseStatus(doc)).toEqual({ kind: 'counted', text: 'Included in your 2025-26 deductions for Free Tax Returns.' });
  });
  it('supplier-filed waits for a person', () => expect(workExpenseStatus({ ...doc, categorySource: 'supplier' }).kind).toBe('to_confirm'));
  it('not a tax category', () => expect(workExpenseStatus({ ...doc, taxLabel: null, engineRowId: 'unassigned' }).kind).toBe('none'));
  it('foreign currency, no date, rejected', () => {
    expect(workExpenseStatus({ ...doc, currency: 'IDR' }).kind).toBe('not_counted');
    expect(workExpenseStatus({ ...doc, issueDate: '' }).kind).toBe('not_counted');
    expect(workExpenseStatus({ ...doc, reviewStatus: 'rejected' }).kind).toBe('not_counted');
  });
});

describe('describeSendContents', () => {
  it('lines, receipts and km', () => {
    expect(describeSendContents('2025-26', { lines: 2, receipts: 3, workKilometres: 1150, toConfirm: 0 })).toBe(
      'Ready to send for 2025-26: 2 deduction lines from 3 receipts and 1,150 work km.',
    );
  });
  it('km only, singular, and receipts to confirm', () => {
    expect(describeSendContents('2025-26', { lines: 0, receipts: 0, workKilometres: 1150, toConfirm: 1 })).toBe(
      'Ready to send for 2025-26: 1,150 work km. 1 receipt was filed in a work category because an earlier receipt from the same shop was; it goes once you confirm its category.',
    );
    expect(describeSendContents('2025-26', { lines: 1, receipts: 1, workKilometres: 0, toConfirm: 0 })).toBe(
      'Ready to send for 2025-26: 1 deduction line from 1 receipt.',
    );
  });
  it('nothing yet says how to add a receipt', () => {
    expect(describeSendContents('2025-26', { lines: 0, receipts: 0, workKilometres: 0, toConfirm: 0 })).toBe(
      'Nothing to send for 2025-26 yet. To include a receipt, open it and choose a work category.',
    );
  });
});
