import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CategorySetting, DocumentView } from '@snap/api-contract';

vi.mock('@/lib/panels/document-actions', () => ({ setDocumentCategory: vi.fn(), setLineCategories: vi.fn() }));

import { WorkExpenseCard } from './WorkExpenseCard';

const cat = (id: string, name: string, taxLabel: string | null = null, engineRowId: string | null = null, active = true): CategorySetting => ({
  id, name, taxLabel, engineRowId, privateUsePercent: null, monthlyBudget: null, documentCount: 0, totalSpend: '0', active, deletable: false,
});
const categories = [
  cat('g', 'Groceries'),
  cat('t', 'Work tools and equipment', 'D5', 'tools'),
  cat('f', 'Work car: fuel', 'D1', 'fuelReceiptTotal'),
  cat('r', 'Rental: agent fees', 'RENTAL', 'mgmtFees', false),
];
const doc = (o: Partial<DocumentView>) =>
  ({
    id: 'd1', category: 'Uncategorised', categoryId: null, categorySource: null, taxLabel: null, engineRowId: 'unassigned',
    issueDate: '2026-03-02', currency: 'AUD', reviewStatus: 'reviewed', ...o,
  }) as DocumentView;
const render = (d: DocumentView, canEdit = true) =>
  renderToStaticMarkup(<WorkExpenseCard document={d} categories={categories} canEdit={canEdit} workspaceId="w" path="/app/documents/d1" />);

describe('WorkExpenseCard (web)', () => {
  it('offers work categories first, with everyday ones and none after; switched-off ones hidden', () => {
    const html = render(doc({}));
    expect(html.indexOf('Work and other tax deductions')).toBeLessThan(html.indexOf('Everyday spending'));
    expect(html.indexOf('Work car: fuel')).toBeLessThan(html.indexOf('Work tools and equipment'));
    expect(html).toContain('No category');
    expect(html).not.toContain('Rental: agent fees');
    expect(html).toContain('choose a work category');
  });
  it('a filed work receipt shows its ATO label and year', () => {
    const html = render(doc({ category: 'Work tools and equipment', categoryId: 't', categorySource: 'user', taxLabel: 'D5', engineRowId: 'tools' }));
    expect(html).toContain('D5 · Other work-related expenses');
    expect(html).toContain('Included in your 2025-26 deductions for Free Tax Returns.');
    expect(html).not.toContain('Confirm category');
  });
  it('a supplier-filed one asks to be confirmed; read-only gets no form', () => {
    const supplier = doc({ category: 'Work car: fuel', categoryId: 'f', categorySource: 'supplier', taxLabel: 'D1', engineRowId: 'fuelReceiptTotal' });
    expect(render(supplier)).toContain('Confirm category');
    expect(render(supplier, false)).not.toContain('<select');
  });
  it('work lines: each line with what it cost, the filed one ticked with its category, and the running total', () => {
    const line = (lineNumber: number, description: string, amount: string, gstFree: boolean, categoryId: string | null) => ({
      lineNumber, description, quantity: 1, unitPrice: amount, amount, gstFree, category: categoryId ? 'Work tools and equipment' : null, categoryId, confidence: 1,
    });
    const docket = doc({
      category: 'Groceries', categoryId: 'g', categorySource: 'user', payableAmount: '64.30', taxAmount: '2.27',
      lines: [line(1, 'Milk 2L', '3.10', true, null), line(2, 'Hammer 450g', '25.00', false, 't'), line(3, 'Fruit and veg', '36.20', true, null)],
    });
    const html = render(docket);
    expect(html).toContain('Work lines');
    expect(html).toContain('Hammer 450g');
    expect(html).toContain('$25.00');
    expect(html.match(/type="checkbox"/g)?.length).toBe(3);
    expect(html.match(/checked=""/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Work category for Hammer 450g"');
    expect(html).toContain('Marked for work: $25.00');
    // The card's status says what goes, GST included, for which year, and that the rest stays out.
    expect(html).toContain('1 work line ($25.00, GST included) included in your 2025-26 deductions for Free Tax Returns. The rest of the receipt stays out.');
    // Read-only: the marked line is listed, nothing to tick.
    const ro = render(docket, false);
    expect(ro).toContain('Hammer 450g · $25.00 · Work tools and equipment');
    expect(ro).not.toContain('type="checkbox"');
  });
});
