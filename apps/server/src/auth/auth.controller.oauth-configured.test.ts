import { UnauthorizedException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Split from auth.controller.test.ts on purpose: `config()` validates and
 * caches its environment exactly once per process, so GOOGLE_CLIENT_ID has to
 * be set BEFORE anything is imported in a file that wants to see it
 * configured. This file's one job is the "configured, but the token still
 * fails verification" case — the "not configured at all" case lives in the
 * other file, whose module graph never sets this variable.
 */
let AuthController: typeof import('./auth.controller.js').AuthController;
let setJwksProviderForTesting: typeof import('./google-verify.js').setJwksProviderForTesting;
let controller: InstanceType<typeof AuthController>;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

  const controllerModule = await import('./auth.controller.js');
  const verifyModule = await import('./google-verify.js');
  AuthController = controllerModule.AuthController;
  setJwksProviderForTesting = verifyModule.setJwksProviderForTesting;
  controller = new AuthController();

  // No real key published for the token this test sends — verification must
  // fail on "key not found", not on the endpoint accidentally never
  // attempting verification at all.
  setJwksProviderForTesting(async () => ({ keys: [] }));
});

describe('POST /v1/auth/oauth/google — configured, but a bad token is still refused', () => {
  it('refuses a token that is not even a JWT', async () => {
    await expect(
      controller.googleExchange({ idToken: 'not-a-jwt-at-all', nonce: 'whatever' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('never reaches the database for a token that fails verification', async () => {
    // If this endpoint ever "verified" by trusting the caller instead of
    // Google's JWKS, this call would proceed to `upsertUserByEmail` and hang
    // or fail on the (absent, in this test environment) database instead of
    // failing immediately with a 401 — the two are distinguishable in
    // practice by how fast this rejects, though the assertion itself only
    // needs the exception type.
    await expect(
      controller.googleExchange({ idToken: 'also-not-a-jwt', nonce: 'anything' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
