import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SendToFtr } from './SendToFtr';

describe('SendToFtr', () => {
  it('names the year it exports on the button and in the copy', () => {
    const html = renderToStaticMarkup(<SendToFtr financialYear="2025-26" />);
    expect(html).toContain('Send 2025-26 to Free Tax Returns');
    expect(html).toContain('Download your 2025-26 deductions');
    expect(html).toContain('no merchant names');
  });
});
