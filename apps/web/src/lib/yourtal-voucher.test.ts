import { describe, expect, it } from 'vitest';

import {
  VOUCHER_ERROR_CODES,
  cleanVoucherCode,
  hasPendingVoucher,
  looksLikeVoucherCode,
  redemptionLabel,
  voucherErrorMessage,
  voucherUnavailableNote,
} from './yourtal-voucher';

describe('yourtal-voucher words', () => {
  it('words every error code, never as money', () => {
    for (const code of VOUCHER_ERROR_CODES) {
      const text = voucherErrorMessage(code);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\$|cash|money|refund/i);
    }
  });
  it('dates already_redeemed, and falls back safely', () => {
    expect(voucherErrorMessage('already_redeemed', '2026-11-03T01:00:00Z')).toBe(
      'This voucher was already used: 50 scans were added on 3 Nov 2026.',
    );
    expect(voucherErrorMessage('already_redeemed')).toContain('already used');
    expect(voucherErrorMessage('???')).toContain('Nothing was taken');
    expect(voucherErrorMessage(null)).toContain('Nothing was taken');
  });
  it('cleans dashes, spaces and case', () => {
    expect(cleanVoucherCode(' abcd-efgh ijkl-mnpq-r ')).toBe('ABCDEFGHIJKLMNPQR');
    expect(looksLikeVoucherCode('ABCD-EFGH-JKMN-PQRS-T')).toBe(true);
    expect(looksLikeVoucherCode('ABCD-EFGH')).toBe(false);
  });
  it('explains region and role only', () => {
    const base = { redemptions: [] };
    expect(voucherUnavailableNote({ ...base, available: false, reason: 'region' })).toContain('Australian');
    expect(voucherUnavailableNote({ ...base, available: false, reason: 'role' })).toContain('owner or admin');
    expect(voucherUnavailableNote({ ...base, available: false, reason: 'not_linked' })).toBeNull();
    expect(voucherUnavailableNote({ ...base, available: false, reason: 'not_configured' })).toBeNull();
    expect(voucherUnavailableNote({ ...base, available: true })).toBeNull();
    expect(voucherUnavailableNote(undefined)).toBeNull();
  });
  it('labels history rows and spots pending', () => {
    const r = { id: '1', credits: 50, createdAt: '2026-11-03T01:00:00Z', grantedAt: null };
    expect(redemptionLabel({ ...r, state: 'granted', grantedAt: '2026-11-03T01:01:00Z' })).toBe('50 scans added on 3 Nov 2026');
    expect(redemptionLabel({ ...r, state: 'pending' })).toContain('Adding 50 scans');
    expect(redemptionLabel({ ...r, state: 'failed' })).toContain('nothing was taken');
    expect(hasPendingVoucher({ available: true, redemptions: [{ ...r, state: 'pending' }] })).toBe(true);
    expect(hasPendingVoucher({ available: true, redemptions: [] })).toBe(false);
  });
});
