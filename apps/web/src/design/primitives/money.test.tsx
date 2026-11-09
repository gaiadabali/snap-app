import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OtherCurrencies } from '@/app/app/_shell/OtherCurrencies';
import { Money, WorkspaceCurrency } from './money';

// Money joins `Rp` and the figure with a no-break space; compare with a plain one.
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ');

describe('<Money> currency', () => {
  it('defaults to AUD outside a workspace', () => {
    expect(text(renderToStaticMarkup(<Money amount="1234.5" />))).toBe('$1,234.50');
  });

  it("defaults to the workspace's currency inside one", () => {
    const html = renderToStaticMarkup(
      <WorkspaceCurrency currency="IDR">
        <Money amount="70920.0000" />
      </WorkspaceCurrency>,
    );
    expect(text(html)).toBe('Rp 70.920');
  });

  it('an explicit currency wins over the workspace (SnapApp prices stay AUD)', () => {
    const html = renderToStaticMarkup(
      <WorkspaceCurrency currency="IDR">
        <Money amount="4.99" currency="AUD" />
      </WorkspaceCurrency>,
    );
    expect(text(html)).toBe('$4.99');
  });
});

describe('<OtherCurrencies>', () => {
  it('lists each other currency in its own money, and nothing when there are none', () => {
    const html = renderToStaticMarkup(
      <OtherCurrencies totals={[{ currency: 'IDR', total: '70920.0000', count: 2 }]} />,
    );
    expect(text(html)).toContain('Rp 70.920 (2 receipts)');
    expect(renderToStaticMarkup(<OtherCurrencies totals={[]} />)).toBe('');
    expect(renderToStaticMarkup(<OtherCurrencies />)).toBe('');
  });
});
