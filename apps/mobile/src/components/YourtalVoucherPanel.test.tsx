import type { YourtalLinkStatus } from '@snap/api-contract';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VOUCHER_ERROR_CODES, voucherErrorMessage } from '@/lib/yourtal-voucher';

import { YourtalVoucherPanel, type YourtalVoucherPanelProps } from './YourtalVoucherPanel';

const noop = () => {};
const VOUCHERS: NonNullable<YourtalLinkStatus['vouchers']> = { available: true, redemptions: [] };

function html(over: Partial<YourtalVoucherPanelProps> = {}): string {
  return renderToStaticMarkup(
    createElement(YourtalVoucherPanel, {
      vouchers: VOUCHERS,
      workspaceName: 'Personal',
      code: '',
      onCodeChange: noop,
      onSubmit: noop,
      busy: false,
      outcome: null,
      ...over,
    }),
  );
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('YourtalVoucherPanel', () => {
  it('shows the form and the hint', () => {
    const t = text(html());
    expect(t).toContain('Use a YourTal voucher');
    expect(t).toContain('Voucher code');
    expect(t).toContain('Add scans');
    expect(t).toContain("Scans from a voucher don't earn YourTal points.");
  });
  it('granted names the workspace', () => {
    expect(text(html({ outcome: { kind: 'granted', credits: 50 } }))).toContain('50 scans added to Personal.');
  });
  it('pending says it will finish shortly', () => {
    expect(text(html({ outcome: { kind: 'pending' } }))).toContain('Adding 50 scans. This can take a minute.');
  });
  it('words every error code', () => {
    for (const code of VOUCHER_ERROR_CODES) {
      expect(text(html({ outcome: { kind: 'error', code } }))).toContain(voucherErrorMessage(code));
    }
  });
  it('dates an already-redeemed voucher', () => {
    expect(text(html({ outcome: { kind: 'error', code: 'already_redeemed', redeemedAt: '2026-11-03T01:00:00Z' } }))).toContain(
      '50 scans were added on 3 Nov 2026',
    );
  });
  it('lists past redemptions', () => {
    const t = text(
      html({
        vouchers: {
          available: true,
          redemptions: [{ id: 'a', state: 'granted', credits: 50, createdAt: '2026-11-03T01:00:00Z', grantedAt: '2026-11-03T01:01:00Z' }],
        },
      }),
    );
    expect(t).toContain('Vouchers used');
    expect(t).toContain('50 scans added on 3 Nov 2026');
  });
  it('explains region and role, with no form', () => {
    for (const [reason, word] of [['region', 'Australian'], ['role', 'owner or admin']] as const) {
      const t = text(html({ vouchers: { available: false, reason, redemptions: [] } }));
      expect(t).toContain(word);
      expect(t).not.toContain('Voucher code');
    }
  });
  it('renders nothing for not_linked and not_configured', () => {
    for (const reason of ['not_linked', 'not_configured'] as const) {
      expect(html({ vouchers: { available: false, reason, redemptions: [] } })).toBe('');
    }
  });
});
