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

  it('with directSend offers the send and keeps the file', () => {
    const html = renderToStaticMarkup(<SendToFtr financialYear="2025-26" directSend />);
    expect(html).toContain('Send to Free Tax Returns');
    expect(html).toContain('Save as a file instead');
    expect(html).toContain('Your 2025-26 deductions go straight to Free Tax Returns. YourTal asks you to confirm, and nothing in your return changes until you accept it there.');
  });

  it('shows Sent with the review link, Nothing was sent, and a fixed failure message', () => {
    const sent = renderToStaticMarkup(
      <SendToFtr financialYear="2026-27" directSend result={{ status: 'sent', year: '2025-26' }} reviewUrl="https://ftr.example/worksheet" />,
    );
    expect(sent).toContain('Sent. Your 2025-26 deductions are waiting in Free Tax Returns.');
    expect(sent).toContain('href="https://ftr.example/worksheet"');
    const no = renderToStaticMarkup(<SendToFtr financialYear="2025-26" directSend result={{ status: 'cancelled' }} />);
    expect(no).toContain('Nothing was sent.');
    expect(no).toContain('Save as a file instead');
    const bad = renderToStaticMarkup(<SendToFtr financialYear="2025-26" directSend result={{ status: 'failed', code: 'ftr_unavailable' }} />);
    expect(bad).toContain("Free Tax Returns isn&#x27;t answering right now");
    expect(renderToStaticMarkup(<SendToFtr financialYear="2025-26" directSend result={{ status: 'failed', code: '<b>x' }} />)).toContain('Something went wrong. Nothing was sent.');
  });

  it('says exactly what will go, in both modes', () => {
    const contents = { lines: 2, receipts: 3, workKilometres: 1150, toConfirm: 1 };
    for (const directSend of [false, true]) {
      const html = renderToStaticMarkup(<SendToFtr financialYear="2025-26" directSend={directSend} contents={contents} />);
      expect(html).toContain('Ready to send for 2025-26: 2 deduction lines from 3 receipts and 1,150 work km.');
      expect(html).toContain('once you confirm its category');
    }
    expect(renderToStaticMarkup(<SendToFtr financialYear="2025-26" />)).not.toContain('Ready to send');
  });
});

