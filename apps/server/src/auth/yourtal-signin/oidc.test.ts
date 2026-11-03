import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startFakeYourTalOidc, type FakeYourTalOidc } from '../../test-support/fake-yourtal-oidc.js';

/**
 * Which authorization parameters `startAuthorization` sends. No database: only
 * the stand-in provider's discovery document is read.
 */
describe('startAuthorization: prompt', () => {
  let yt: FakeYourTalOidc;
  let keyDir: string;
  let start: typeof import('./oidc.js').startAuthorization;

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    keyDir = mkdtempSync(join(tmpdir(), 'snap-yt-oidc-prompt-'));
    const keyFile = join(keyDir, 'yourtal-oidc-web.jwk');
    writeFileSync(keyFile, JSON.stringify(yt.webPrivateJwk), { mode: 0o600 });
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
    vi.stubEnv('TOKEN_SECRET', 'test-only-secret-at-least-32-characters-long');
    vi.stubEnv('WEB_PUBLIC_URL', 'https://snap-apps.example');
    vi.stubEnv('YOURTAL_OIDC_ISSUER', yt.issuer);
    vi.stubEnv('YOURTAL_OIDC_WEB_CLIENT_ID', yt.webClientId);
    vi.stubEnv('YOURTAL_OIDC_MOBILE_CLIENT_ID', yt.mobileClientId);
    vi.stubEnv('YOURTAL_OIDC_WEB_REDIRECT_URI', yt.webRedirectUri);
    vi.stubEnv('YOURTAL_OIDC_KEY_FILE', keyFile);
    start = (await import('./oidc.js')).startAuthorization;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await yt?.close();
    rmSync(keyDir, { recursive: true, force: true });
  });

  const params = async (options: { signUp: boolean; freshSignIn?: boolean }) =>
    new URL((await start('web', { locale: 'en-AU', ...options })).url).searchParams;

  it('sends no prompt and no max_age for an ordinary sign-in', async () => {
    for (const p of [await params({ signUp: false }), await params({ signUp: false, freshSignIn: false })]) {
      expect(p.has('prompt')).toBe(false);
      expect(p.has('max_age')).toBe(false);
    }
  });

  it('sends prompt=login, and still no max_age, for a fresh sign-in', async () => {
    const p = await params({ signUp: false, freshSignIn: true });
    expect(p.get('prompt')).toBe('login');
    expect(p.has('max_age')).toBe(false);
  });

  it('keeps prompt=create for sign-up even if a fresh sign-in is asked for', async () => {
    expect((await params({ signUp: true, freshSignIn: true })).get('prompt')).toBe('create');
  });
});
