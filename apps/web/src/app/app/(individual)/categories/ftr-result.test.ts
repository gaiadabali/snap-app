import { describe, expect, it } from 'vitest';

import { ftrResult } from './ftr-result';

describe('ftrResult', () => {
  it('reads the callback codes', () => {
    expect(ftrResult({ ftr: 'sent', fy: '2025-26' })).toEqual({ status: 'sent', year: '2025-26' });
    expect(ftrResult({ ftr: 'cancelled' })).toEqual({ status: 'cancelled' });
    expect(ftrResult({ ftr: 'failed', code: 'rate_limited' })).toEqual({ status: 'failed', code: 'rate_limited' });
  });
  it('shows nothing for a sent without a valid year, or anything else', () => {
    expect(ftrResult({ ftr: 'sent' })).toBeUndefined();
    expect(ftrResult({ ftr: 'sent', fy: '<b>x</b>' })).toBeUndefined();
    expect(ftrResult({ ftr: 'bogus' })).toBeUndefined();
    expect(ftrResult({})).toBeUndefined();
  });
});
