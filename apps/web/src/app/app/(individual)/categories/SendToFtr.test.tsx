import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SendToFtr } from './SendToFtr';

describe('SendToFtr', () => {
  it('is a download link to the bundle route', () => {
    const html = renderToStaticMarkup(<SendToFtr />);
    expect(html).toContain('href="/app/deduction-bundle"');
    expect(html).toContain('download');
    expect(html).toContain('Send to Free Tax Returns');
  });
});
