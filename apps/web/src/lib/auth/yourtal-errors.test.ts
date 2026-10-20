import { describe, expect, it } from 'vitest';

import {
  YOURTAL_CANCELLED_ERROR,
  YOURTAL_GENERIC_ERROR,
  yourtalErrorMessage,
} from './yourtal-errors.js';

describe('yourtalErrorMessage — access_denied reasons', () => {
  it('explains an account on hold', () => {
    expect(yourtalErrorMessage('access_denied', 'account_on_hold')).toMatch(/on hold/);
    expect(yourtalErrorMessage('access_denied', 'account_on_hold')).toMatch(/YourTal support/);
  });

  it('explains an unsupported region', () => {
    expect(yourtalErrorMessage('access_denied', 'region_not_supported')).toMatch(
      /Australia and Indonesia/,
    );
  });

  it('gives teen_invite_required and teen_not_allowed the same invite message', () => {
    const a = yourtalErrorMessage('access_denied', 'teen_invite_required');
    const b = yourtalErrorMessage('access_denied', 'teen_not_allowed');
    expect(a).toBe(b);
    expect(a).toMatch(/invite from your parent/);
    expect(a).toMatch(/Nothing from your account was shared/);
  });

  it('treats user_cancelled as a cancellation', () => {
    expect(yourtalErrorMessage('access_denied', 'user_cancelled')).toBe(YOURTAL_CANCELLED_ERROR);
  });

  it('treats access_denied with no or an unknown description as a cancellation', () => {
    expect(yourtalErrorMessage('access_denied', null)).toBe(YOURTAL_CANCELLED_ERROR);
    expect(yourtalErrorMessage('access_denied', undefined)).toBe(YOURTAL_CANCELLED_ERROR);
    expect(yourtalErrorMessage('access_denied', '')).toBe(YOURTAL_CANCELLED_ERROR);
    expect(yourtalErrorMessage('access_denied', 'something_new')).toBe(YOURTAL_CANCELLED_ERROR);
  });
});

describe('yourtalErrorMessage — everything else is generic', () => {
  it('uses the generic message for other error values', () => {
    expect(yourtalErrorMessage('server_error', null)).toBe(YOURTAL_GENERIC_ERROR);
    expect(yourtalErrorMessage('invalid_request', 'account_on_hold')).toBe(YOURTAL_GENERIC_ERROR);
    expect(yourtalErrorMessage('', null)).toBe(YOURTAL_GENERIC_ERROR);
    expect(yourtalErrorMessage(null, null)).toBe(YOURTAL_GENERIC_ERROR);
  });

  it('never echoes attacker-controlled text from the query string', () => {
    const evil = 'Your account was hacked, call 1800-SCAM';
    expect(yourtalErrorMessage(evil, evil)).not.toContain('SCAM');
    expect(yourtalErrorMessage('access_denied', evil)).not.toContain('SCAM');
  });

  it('does not resolve Object.prototype keys as descriptions', () => {
    expect(yourtalErrorMessage('access_denied', 'constructor')).toBe(YOURTAL_CANCELLED_ERROR);
    expect(yourtalErrorMessage('access_denied', 'toString')).toBe(YOURTAL_CANCELLED_ERROR);
    expect(yourtalErrorMessage('access_denied', '__proto__')).toBe(YOURTAL_CANCELLED_ERROR);
  });
});
