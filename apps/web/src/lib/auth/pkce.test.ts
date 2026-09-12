import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from './pkce.js';

describe('PKCE code verifier / challenge', () => {
  it('generates a verifier of the length RFC 7636 requires (43-128 chars, base64url)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('derives the challenge as BASE64URL(SHA256(verifier)) — the S256 method', () => {
    const verifier = generateCodeVerifier();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(codeChallengeFromVerifier(verifier)).toBe(expected);
  });

  it('is deterministic for the same verifier and different for a different one', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(codeChallengeFromVerifier(a)).toBe(codeChallengeFromVerifier(a));
    expect(codeChallengeFromVerifier(a)).not.toBe(codeChallengeFromVerifier(b));
  });

  it('never generates the same verifier twice in practice', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe('state and nonce', () => {
  it('are non-empty, url-safe, and unique per call', () => {
    const states = new Set(Array.from({ length: 20 }, () => generateState()));
    const nonces = new Set(Array.from({ length: 20 }, () => generateNonce()));
    expect(states.size).toBe(20);
    expect(nonces.size).toBe(20);
    for (const s of states) expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
