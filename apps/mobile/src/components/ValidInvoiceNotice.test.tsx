import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ValidInvoiceNotice, validInvoiceDetail } from './ValidInvoiceNotice';

const fmt = (v: string | null | undefined) => `$${v}`;
const base = { taxAmount: '12.34', fmt };

describe('valid tax invoice verdict', () => {
  it('business AU: the credit is claimable at label 1B', () => {
    const t = validInvoiceDetail({ ...base, workspace: 'business', taxName: 'GST' });
    expect(t).toBe('Meets the ATO requirements, so the $12.34 GST credit is claimable at label 1B.');
  });

  it('personal AU: meets the requirements, no credit claim, no label 1B', () => {
    const t = validInvoiceDetail({ ...base, workspace: 'personal', taxName: 'GST' });
    expect(t).toBe('Meets the ATO requirements for a tax invoice.');
    expect(t).not.toMatch(/1B|credit|claimable/);
  });

  it('non-AU (PPN): no ATO, no label 1B, for either kind', () => {
    for (const workspace of ['business', 'personal'] as const) {
      const t = validInvoiceDetail({ ...base, workspace, taxName: 'PPN' });
      expect(t).toBe('Meets the requirements for a tax invoice.');
      expect(t).not.toMatch(/ATO|1B|GST/);
    }
  });

  it('renders the heading and the line', () => {
    const html = renderToStaticMarkup(createElement(ValidInvoiceNotice, { ...base, workspace: 'personal', taxName: 'GST' }));
    expect(html).toContain('Valid tax invoice');
    expect(html).toContain('Meets the ATO requirements for a tax invoice.');
    expect(html).not.toContain('label 1B');
  });
});
