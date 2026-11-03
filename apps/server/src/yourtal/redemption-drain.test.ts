import { describe, expect, it } from 'vitest';

import { publicRedemption } from './redeem.service.js';
import { redemptionBackoffSeconds } from './redemption-drain.js';
import type { RedemptionRow, RedemptionStatus } from './redemptions.repo.js';

describe('the redemption drain backoff', () => {
  it('starts at 15 s, doubles, and stops at 15 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 30].map(redemptionBackoffSeconds)).toEqual([15, 30, 60, 120, 240, 480, 900, 900, 900]);
    expect(redemptionBackoffSeconds(0)).toBe(15);
  });
});

describe('what a client sees of a redemption', () => {
  const row = (status: RedemptionStatus) =>
    ({ id: 'r1', status, credits: 50, created_at: '2026-11-03T00:00:00Z', finished_at: '2026-11-03T00:01:00Z' }) as RedemptionRow;

  it('granted only once the credits exist; any other final is failed; the rest pending', () => {
    expect(publicRedemption(row('granted'))).toEqual({
      id: 'r1', state: 'granted', credits: 50, createdAt: '2026-11-03T00:00:00Z', grantedAt: '2026-11-03T00:01:00Z',
    });
    for (const s of ['voided', 'expired', 'refused', 'abandoned', 'failed'] as const) {
      expect(publicRedemption(row(s))).toMatchObject({ state: 'failed', grantedAt: null });
    }
    for (const s of ['authorizing', 'authorized', 'capturing', 'captured', 'voiding', 'needs_review'] as const) {
      expect(publicRedemption(row(s))).toMatchObject({ state: 'pending', grantedAt: null });
    }
  });
});
