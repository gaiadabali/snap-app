import { describe, expect, it } from 'vitest';

import { packOAuthState, unpackOAuthState, verifyState, type OAuthState } from './oauth-state.js';

const sample: OAuthState = {
  state: 'state-abc',
  codeVerifier: 'verifier-xyz',
  nonce: 'nonce-123',
  returnTo: '/app/business',
};

describe('pack / unpack', () => {
  it('round-trips a valid state', () => {
    expect(unpackOAuthState(packOAuthState(sample))).toEqual(sample);
  });

  it('returns null for garbage input', () => {
    expect(unpackOAuthState('not-valid-base64url-json')).toBeNull();
  });

  it('returns null for undefined/missing cookie value', () => {
    expect(unpackOAuthState(undefined)).toBeNull();
    expect(unpackOAuthState(null)).toBeNull();
  });

  it('returns null when a required field is missing (a truncated or tampered cookie)', () => {
    const partial = Buffer.from(JSON.stringify({ state: 'x' }), 'utf8').toString('base64url');
    expect(unpackOAuthState(partial)).toBeNull();
  });

  it('returns null when a field has the wrong type', () => {
    const wrongType = Buffer.from(
      JSON.stringify({ ...sample, nonce: 12345 }),
      'utf8',
    ).toString('base64url');
    expect(unpackOAuthState(wrongType)).toBeNull();
  });
});

describe('verifyState — the CSRF check on the Google callback', () => {
  it('accepts a matching state', () => {
    expect(verifyState(sample, sample.state)).toBe(true);
  });

  it('refuses a mismatched state — a forged or replayed callback', () => {
    expect(verifyState(sample, 'a-different-state-entirely')).toBe(false);
  });

  it('refuses when there is no saved cookie at all (expired, cleared, or never set)', () => {
    expect(verifyState(null, sample.state)).toBe(false);
  });

  it('refuses when the callback carries no state param', () => {
    expect(verifyState(sample, null)).toBe(false);
  });

  it('a missing cookie and a mismatched state fail identically — both simply `false`', () => {
    // Deliberately not distinguished by the caller: the Google callback route
    // shows the same "no longer valid" message for both, exactly like an
    // expired vs. forged magic-link token on the server.
    expect(verifyState(null, 'anything')).toBe(verifyState(sample, 'wrong'));
  });
});
