import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OtherCurrencies } from '@/app/app/_shell/OtherCurrencies';
import { Money, WorkspaceCurrency, useTaxName } from './money';

// Money joins `Rp` and the figure with a no-break space; compare with a plain one.
const text = (html: string) =>
  html
    .split('<')
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf('>') + 1)))
    .join('')
    .replace(/\u00a0/g, ' ');

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

describe('<Money> outside the AUD/IDR table', () => {
  it('EUR and USD never print under the AUD dollar sign', () => {
    expect(text(renderToStaticMarkup(<Money amount="5.5000" currency="EUR" />))).toBe('EUR 5.50');
    expect(text(renderToStaticMarkup(<Money amount="1234.5" currency="USD" />))).toBe('USD 1,234.50');
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

describe('useTaxName', () => {
  const Label = ({ currency }: { currency?: string }) => <>{useTaxName(currency)}</>;

  it("uses the server's name for a workspace figure, and falls back to the currency without one", () => {
    expect(
      renderToStaticMarkup(
        <WorkspaceCurrency currency="IDR" taxName="VAT">
          <Label />
        </WorkspaceCurrency>,
      ),
    ).toBe('VAT');
    expect(
      renderToStaticMarkup(
        <WorkspaceCurrency currency="IDR">
          <Label />
        </WorkspaceCurrency>,
      ),
    ).toBe('PPN');
  });

  it('a document in another currency is named for that currency', () => {
    expect(
      renderToStaticMarkup(
        <WorkspaceCurrency currency="IDR" taxName="PPN">
          <Label currency="AUD" />
        </WorkspaceCurrency>,
      ),
    ).toBe('GST');
  });
});
