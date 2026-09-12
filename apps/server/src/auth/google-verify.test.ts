import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  GoogleIdTokenError,
  setJwksProviderForTesting,
  verifyGoogleIdToken,
} from './google-verify.js';

/**
 * A self-signed stand-in for Google's JWKS + ID tokens.
 *
 * No network call and no real Google credentials are involved — a real
 * RS256 keypair is generated locally, exposed to `verifyGoogleIdToken` as its
 * "JWKS" via the test seam, and used to hand-craft JWTs exactly the shape
 * Google issues. That is what makes this a real test of the verification
 * logic (signature, issuer, audience, expiry, nonce, email_verified) rather
 * than a test that merely calls the function.
 */
const KID = 'test-key-1';
const AUDIENCE = 'test-client-id.apps.googleusercontent.com';

let privateKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  setJwksProviderForTesting(async () => ({
    keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' } as never],
  }));
});

afterEach(() => {
  // Keep the fake provider installed (beforeAll only runs once), just clear
  // whatever the cache-busting path inside the module may have touched.
});

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

type Claims = Record<string, unknown>;

/** Sign a JWT with the test key, or optionally a WRONG key to simulate a forgery. */
function mintIdToken(
  claims: Claims,
  options: { alg?: string; kid?: string | null; wrongKey?: boolean } = {},
): string {
  const header = { alg: options.alg ?? 'RS256', kid: options.kid === undefined ? KID : options.kid };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyPem = options.wrongKey
    ? generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ type: 'pkcs1', format: 'pem' })
        .toString()
    : privateKeyPem;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput), createPrivateKey(keyPem));
  return `${signingInput}.${b64url(signature)}`;
}

function baseClaims(overrides: Claims = {}): Claims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    sub: 'google-subject-123',
    email: 'person@example.com',
    email_verified: true,
    name: 'Person Example',
    nonce: 'expected-nonce',
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

describe('verifyGoogleIdToken — the happy path', () => {
  it('accepts a genuinely valid token and returns the identity', async () => {
    const token = mintIdToken(baseClaims());
    const identity = await verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce');
    expect(identity).toEqual({
      subject: 'google-subject-123',
      email: 'person@example.com',
      displayName: 'Person Example',
    });
  });

  it('lowercases the email', async () => {
    const token = mintIdToken(baseClaims({ email: 'Person@Example.com' }));
    const identity = await verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce');
    expect(identity.email).toBe('person@example.com');
  });

  it('falls back to the local part of the email when name is absent', async () => {
    const token = mintIdToken(baseClaims({ name: undefined }));
    const identity = await verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce');
    expect(identity.displayName).toBe('person');
  });
});

describe('verifyGoogleIdToken — every negative case a forged or stale token can take', () => {
  it('rejects a token signed with the wrong key (the actual forgery case)', async () => {
    const token = mintIdToken(baseClaims(), { wrongKey: true });
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      GoogleIdTokenError,
    );
  });

  it('rejects a token whose payload was edited after signing (classic tamper)', async () => {
    const token = mintIdToken(baseClaims());
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const claims = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
    const tamperedPayload = b64url(JSON.stringify({ ...claims, email: 'attacker@example.com' }));
    const tampered = `${headerB64}.${tamperedPayload}.${sigB64}`;
    await expect(verifyGoogleIdToken(tampered, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      GoogleIdTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const token = mintIdToken(baseClaims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'expired',
    );
  });

  it('rejects the wrong audience', async () => {
    const token = mintIdToken(baseClaims({ aud: 'someone-elses-client-id' }));
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'audience',
    );
  });

  it('rejects the wrong issuer', async () => {
    const token = mintIdToken(baseClaims({ iss: 'https://evil.example.com' }));
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'issuer',
    );
  });

  it('rejects a mismatched nonce — the replay-from-another-attempt case', async () => {
    const token = mintIdToken(baseClaims({ nonce: 'a-different-attempt-entirely' }));
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'sign-in attempt',
    );
  });

  it('rejects an unverified email, even with an otherwise perfect signature', async () => {
    const token = mintIdToken(baseClaims({ email_verified: false }));
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'verified',
    );
  });

  it('rejects alg:none and any non-RS256 algorithm', async () => {
    const token = mintIdToken(baseClaims(), { alg: 'none' });
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'algorithm',
    );
  });

  it('rejects a token with no key id', async () => {
    const token = mintIdToken(baseClaims(), { kid: null });
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      GoogleIdTokenError,
    );
  });

  it('rejects a key id Google never published', async () => {
    const token = mintIdToken(baseClaims(), { kid: 'no-such-key' });
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      'not found',
    );
  });

  it('rejects something that is not a JWT at all', async () => {
    await expect(verifyGoogleIdToken('not-a-jwt', AUDIENCE, 'expected-nonce')).rejects.toThrow(
      GoogleIdTokenError,
    );
  });

  it('rejects a token missing sub/email entirely', async () => {
    const token = mintIdToken(baseClaims({ email: undefined, sub: undefined }));
    await expect(verifyGoogleIdToken(token, AUDIENCE, 'expected-nonce')).rejects.toThrow(
      GoogleIdTokenError,
    );
  });
});
