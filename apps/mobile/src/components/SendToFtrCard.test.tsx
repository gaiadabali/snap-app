import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SendToFtrCard } from './SendToFtrCard';

describe('SendToFtrCard', () => {
  it('shows the button and says what the file holds', () => {
    const html = renderToStaticMarkup(createElement(SendToFtrCard, { financialYear: '2025-26', busy: false, onSend: () => {} }));
    expect(html).toContain('Send 2025-26 to Free Tax Returns');
    expect(html).toContain('no merchant names');
  });
});
