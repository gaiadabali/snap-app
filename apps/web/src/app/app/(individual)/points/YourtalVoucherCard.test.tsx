import type { YourtalLinkStatus } from '@snap/api-contract';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VOUCHER_ERROR_CODES, voucherErrorMessage } from '@/lib/yourtal-voucher';

import { YourtalVoucherCard, type YourtalVoucherCardProps } from './YourtalVoucherCard';

const noop = () => {};
const VOUCHERS: NonNullable<YourtalLinkStatus['vouchers']> = { available: true, redemptions: [] };

function html(over: Partial<YourtalVoucherCardProps> = {}): string {
  return renderToStaticMarkup(
    <YourtalVoucherCard
      vouchers={VOUCHERS}
      workspaceName="Personal"
      code=""
      onCodeChange={noop}
      onSubmit={noop}
      busy={false}
      outcome={null}
      {...over}
    />,
  );
}

describe('YourtalVoucherCard', () => {
  it('shows the form, the hint and a disabled button when empty', () => {
    const out = html();
    expect(out).toContain('Use a YourTal voucher');
    expect(out).toContain('Voucher code');
    expect(out).toContain('XXXX-XXXX-XXXX-XXXX-X');
    expect(out).toContain("don&#x27;t earn YourTal points");
    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>Add scans/);
  });
  it('enables the button once a code is typed, and shows busy', () => {
    expect(html({ code: 'ABCD-EFGH' })).not.toMatch(/ disabled=""/);
    expect(html({ code: 'ABCD-EFGH', busy: true })).toContain('Adding…');
  });
  it('granted names the workspace', () => {
    expect(html({ outcome: { kind: 'granted', credits: 50 } })).toContain('50 scans added to Personal.');
  });
  it('pending says it will finish shortly', () => {
    expect(html({ outcome: { kind: 'pending' } })).toContain('Adding 50 scans. This can take a minute.');
  });
  it('words every error code in an alert', () => {
    for (const code of VOUCHER_ERROR_CODES) {
      const out = html({ outcome: { kind: 'error', code } });
      expect(out).toContain('role="alert"');
      expect(out).toContain(voucherErrorMessage(code).replace(/'/g, '&#x27;'));
    }
  });
  it('dates an already-redeemed voucher', () => {
    expect(html({ outcome: { kind: 'error', code: 'already_redeemed', redeemedAt: '2026-11-03T01:00:00Z' } })).toContain(
      'were added on 3 Nov 2026',
    );
  });
  it('lists past redemptions', () => {
    const out = html({
      vouchers: {
        available: true,
        redemptions: [
          { id: 'a', state: 'granted', credits: 50, createdAt: '2026-11-03T01:00:00Z', grantedAt: '2026-11-03T01:01:00Z' },
          { id: 'b', state: 'pending', credits: 50, createdAt: '2026-11-04T01:00:00Z', grantedAt: null },
        ],
      },
    });
    expect(out).toContain('Vouchers used');
    expect(out).toContain('50 scans added on 3 Nov 2026');
    expect(out).toContain('Adding 50 scans (started 4 Nov 2026)');
  });
  it('explains region and role, with no form', () => {
    for (const [reason, text] of [['region', 'Australian'], ['role', 'owner or admin']] as const) {
      const out = html({ vouchers: { available: false, reason, redemptions: [] } });
      expect(out).toContain(text);
      expect(out).not.toContain('Voucher code');
    }
  });
  it('renders nothing for not_linked and not_configured', () => {
    for (const reason of ['not_linked', 'not_configured'] as const) {
      expect(html({ vouchers: { available: false, reason, redemptions: [] } })).toBe('');
    }
  });
});
