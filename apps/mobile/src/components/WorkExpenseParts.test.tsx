import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { workExpenseStatus } from '@snap/api-contract/work-expense';

import { CategoryOptions, WorkExpenseSummary } from './WorkExpenseParts';

const base = { taxLabel: 'D5', engineRowId: 'tools', categorySource: 'user' as const, issueDate: '2026-03-02', currency: 'AUD' };
const face = (over: Partial<Parameters<typeof WorkExpenseSummary>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(WorkExpenseSummary, {
      category: 'Work tools and equipment',
      hint: 'D5 · Other work-related expenses',
      status: workExpenseStatus(base),
      canEdit: true,
      onChoose: () => {},
      onConfirm: () => {},
      ...over,
    }),
  );

describe('WorkExpenseSummary', () => {
  it('a filed work receipt says it goes, and for which year', () => {
    const html = face();
    expect(html).toContain('D5 · Other work-related expenses');
    expect(html).toContain('Included in your 2025-26 deductions for Free Tax Returns.');
    expect(html).toContain('Change category');
    expect(html).not.toContain('Confirm category');
  });
  it('a supplier-filed one offers Confirm', () => {
    const html = face({ status: workExpenseStatus({ ...base, categorySource: 'supplier' }) });
    expect(html).toContain('Confirm category');
  });
  it('an uncategorised one says how to send it; read-only members get no buttons', () => {
    const none = workExpenseStatus({ ...base, taxLabel: null, engineRowId: 'unassigned', categorySource: null });
    expect(face({ category: null, hint: null, status: none })).toContain('Choose a category');
    expect(face({ category: null, hint: null, status: none })).toContain('choose a work category');
    expect(face({ canEdit: false })).not.toContain('Change category');
  });
});

describe('CategoryOptions', () => {
  const c = (name: string, taxLabel: string | null = null, engineRowId: string | null = null, active = true) => ({
    id: name, name, taxLabel, engineRowId, privateUsePercent: null, active,
    monthlyBudget: null, documentCount: 0, totalSpend: '0', deletable: true,
  });
  it('tax categories first with their label, then everyday, then none; switched-off ones hidden', () => {
    const html = renderToStaticMarkup(
      createElement(CategoryOptions, {
        categories: [c('Groceries'), c('Work car: fuel', 'D1', 'fuelReceiptTotal'), c('Rental: agent fees', 'RENTAL', 'mgmtFees', false)],
        currentId: null,
        selected: null,
        onSelect: () => {},
      }),
    );
    const at = (s: string) => html.indexOf(s);
    expect(at('Work and other tax deductions')).toBeLessThan(at('Everyday spending'));
    expect(html).toContain('D1 · Work-related car expenses');
    expect(at('Groceries')).toBeGreaterThan(at('Everyday spending'));
    expect(html).toContain('No category');
    expect(html).not.toContain('Rental: agent fees');
  });
});
