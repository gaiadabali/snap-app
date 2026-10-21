import { describe, expect, it } from 'vitest';

import { AUTH_ERRORS } from './auth-errors';
import { yourtalErrorCode } from './yourtal-errors';

describe('yourtalErrorCode: access_denied reasons', () => {
  it.each([
    ['account_on_hold', 'account_on_hold'],
    ['region_not_supported', 'region_not_supported'],
    ['teen_invite_required', 'teen_invite_required'],
    ['teen_not_allowed', 'teen_invite_required'],
    ['user_cancelled', 'yourtal_cancelled'],
  ])('maps %s to %s', (description, code) => {
    expect(yourtalErrorCode('access_denied', description)).toBe(code);
  });

  it('treats access_denied with no or an unknown description as a cancellation', () => {
    for (const d of [null, undefined, '', 'something_new']) {
      expect(yourtalErrorCode('access_denied', d)).toBe('yourtal_cancelled');
    }
  });

  it('only ever returns a code SnapApp has a message for', () => {
    for (const d of ['account_on_hold', 'region_not_supported', 'teen_not_allowed', 'user_cancelled', 'x']) {
      expect(Object.hasOwn(AUTH_ERRORS, yourtalErrorCode('access_denied', d))).toBe(true);
    }
  });
});

describe('yourtalErrorCode: everything else is a plain failure', () => {
  it('uses yourtal_failed for other error values', () => {
    expect(yourtalErrorCode('server_error', null)).toBe('yourtal_failed');
    expect(yourtalErrorCode('invalid_request', 'account_on_hold')).toBe('yourtal_failed');
    expect(yourtalErrorCode('', null)).toBe('yourtal_failed');
    expect(yourtalErrorCode(null, null)).toBe('yourtal_failed');
  });

  it('never echoes attacker-controlled text from the query string', () => {
    const evil = 'Your account was hacked, call 1800-SCAM';
    expect(yourtalErrorCode(evil, evil)).not.toContain('SCAM');
    expect(yourtalErrorCode('access_denied', evil)).not.toContain('SCAM');
  });

  it('does not resolve Object.prototype keys as descriptions', () => {
    for (const d of ['constructor', 'toString', '__proto__']) {
      expect(yourtalErrorCode('access_denied', d)).toBe('yourtal_cancelled');
    }
  });
});
