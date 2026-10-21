import { describe, expect, it } from 'vitest';

import { AUTH_ERRORS, apiErrorCode, authNotice, isAuthErrorCode } from './auth-errors';

describe('authNotice', () => {
  it('shows nothing for text that is not a known code', () => {
    const evil = 'Your account is locked, call +61 400 000 000';
    expect(authNotice(evil)).toBeNull();
    expect(authNotice('')).toBeNull();
    expect(authNotice(undefined)).toBeNull();
    expect(authNotice(null)).toBeNull();
    expect(authNotice(['yourtal_failed', 'x'])).toBeNull();
  });

  it('does not resolve Object.prototype keys', () => {
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(authNotice(k)).toBeNull();
    }
  });

  it('gives each known code its own fixed message', () => {
    for (const [code, entry] of Object.entries(AUTH_ERRORS)) {
      expect(authNotice(code)?.message).toBe(entry.message);
    }
  });

  it("words the teen refusal in SnapApp's own voice", () => {
    expect(authNotice('teen_invite_required')?.message).toBe(
      'Teen YourTal accounts can use Snap Apps only with an invite from the parent or guardian who approved them.',
    );
  });

  it('shows a cancel as a quiet note, not an error', () => {
    expect(authNotice('yourtal_cancelled')?.quiet).toBe(true);
    expect(authNotice('google_cancelled')?.quiet).toBe(true);
    expect(authNotice('yourtal_failed')?.quiet).toBe(false);
  });
});

describe('apiErrorCode', () => {
  it("passes on the server's code when it is a known one", () => {
    const err = Object.assign(new Error('YourTal says hi'), {
      body: { error: 'teen_invite_required', message: 'text we must not use' },
    });
    expect(apiErrorCode(err, 'yourtal_failed')).toBe('teen_invite_required');
  });

  it('falls back for an unknown code, no body, or a non-object', () => {
    expect(apiErrorCode({ body: { error: 'Bad Request' } }, 'yourtal_failed')).toBe('yourtal_failed');
    expect(apiErrorCode({ body: { error: '__proto__' } }, 'yourtal_failed')).toBe('yourtal_failed');
    expect(apiErrorCode({ body: 'nope' }, 'yourtal_failed')).toBe('yourtal_failed');
    expect(apiErrorCode(new Error('x'), 'yourtal_unavailable')).toBe('yourtal_unavailable');
    expect(apiErrorCode(null, 'yourtal_failed')).toBe('yourtal_failed');
  });

  it('isAuthErrorCode rejects non-strings', () => {
    expect(isAuthErrorCode(5)).toBe(false);
    expect(isAuthErrorCode('link_invalid')).toBe(true);
  });
});
