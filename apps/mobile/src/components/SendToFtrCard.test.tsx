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

  const direct = (over = {}) =>
    renderToStaticMarkup(createElement(SendToFtrCard, { financialYear: '2025-26', busy: false, onSend: () => {}, directSend: true, ...over }));

  it('with directSend offers the send and keeps the file, with the spec copy', () => {
    const html = direct();
    expect(html).toContain('Send to Free Tax Returns');
    expect(html).toContain('Save as a file instead');
    expect(html).toContain('Your 2025-26 deductions go straight to Free Tax Returns. YourTal asks you to confirm, and nothing in your return changes until you accept it there.');
  });

  it('shows sent (with Review them), cancelled and failed', () => {
    const sent = direct({ state: { kind: 'sent', year: '2025-26' }, reviewUrl: 'https://ftr.test/account/import' });
    expect(sent).toContain('Sent. Your 2025-26 deductions are waiting in Free Tax Returns.');
    expect(sent).toContain('Review them');
    expect(direct({ state: { kind: 'cancelled' } })).toContain('Nothing was sent.');
    expect(direct({ state: { kind: 'failed', message: 'Too many tries. Nothing was sent.' } })).toContain('Too many tries.');
  });
});
