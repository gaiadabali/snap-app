import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exportJWK, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Sign in with YourTal settings. `config()` caches the environment once
 * per module instance, so each test resets the module graph and imports fresh
 * copies after stubbing it (the same pattern as yourtal-config.test.ts).
 */
async function load() {
  vi.resetModules();
  const config = await import('../../config.js');
  const settings = await import('./settings.js');
  const oidc = await import('./oidc.js');
  return { config, settings, oidc };
}

const NAMES = [
  'YOURTAL_OIDC_ISSUER',
  'YOURTAL_OIDC_WEB_CLIENT_ID',
  'YOURTAL_OIDC_MOBILE_CLIENT_ID',
  'YOURTAL_OIDC_WEB_REDIRECT_URI',
  'YOURTAL_OIDC_MOBILE_REDIRECT_URI',
  'YOURTAL_OIDC_KEY_FILE',
  'NODE_ENV',
];

const dir = mkdtempSync(join(tmpdir(), 'snap-yt-settings-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  vi.stubEnv('TOKEN_SECRET', 'test-only-secret-at-least-32-characters-long');
  vi.stubEnv('WEB_PUBLIC_URL', 'https://snap-apps.example');
  for (const name of NAMES) {
    vi.stubEnv(name, '');
    delete process.env[name];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function privateJwkFile(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'k1', ...extra }));
  return file;
}

describe('Sign in with YourTal settings', () => {
  it('is OFF with nothing set, and the API still boots', async () => {
    const { config, settings, oidc } = await load();
    expect(() => config.config()).not.toThrow();
    expect(settings.yourtalSignInSettings()).toBeNull();
    expect(oidc.isClientConfigured('web')).toBe(false);
    expect(oidc.isClientConfigured('mobile')).toBe(false);
  });

  it('treats blank lines from compose as unset', async () => {
    vi.stubEnv('YOURTAL_OIDC_ISSUER', '  ');
    vi.stubEnv('YOURTAL_OIDC_WEB_CLIENT_ID', '');
    const { config, settings } = await load();
    expect(() => config.config()).not.toThrow();
    expect(settings.yourtalSignInSettings()).toBeNull();
  });

  it('turns each client on with its id; the website also needs its key', async () => {
    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'https://yourtal.gaiada.com/oidc');
    vi.stubEnv('YOURTAL_OIDC_WEB_CLIENT_ID', 'snapapp-staging-web');
    vi.stubEnv('YOURTAL_OIDC_MOBILE_CLIENT_ID', 'snapapp-staging-mobile');
    const { settings } = await load();
    const s = settings.yourtalSignInSettings();
    expect(s?.issuer.href).toBe('https://yourtal.gaiada.com/oidc');
    expect(s?.web).toBeUndefined(); // no key file
    expect(s?.mobile).toEqual({
      kind: 'mobile',
      clientId: 'snapapp-staging-mobile',
      redirectUri: 'au.com.snapapps.app:/oauth/yourtal',
    });
  });

  it('derives the website redirect URI from WEB_PUBLIC_URL (docs/26 §1.9)', async () => {
    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'https://yourtal.gaiada.com/oidc');
    vi.stubEnv('YOURTAL_OIDC_WEB_CLIENT_ID', 'snapapp-staging-web');
    vi.stubEnv('YOURTAL_OIDC_KEY_FILE', await privateJwkFile('ok.jwk'));
    const { settings } = await load();
    expect(settings.yourtalSignInSettings()?.web).toEqual({
      kind: 'web',
      clientId: 'snapapp-staging-web',
      redirectUri: 'https://snap-apps.example/auth/yourtal/callback',
    });
  });

  it('keeps the website client OFF for a public key, a key without kid, or a missing file', async () => {
    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'https://yourtal.gaiada.com/oidc');
    vi.stubEnv('YOURTAL_OIDC_WEB_CLIENT_ID', 'snapapp-staging-web');

    const { publicKey } = await generateKeyPair('RS256', { extractable: true });
    const publicFile = join(dir, 'public.jwk');
    writeFileSync(publicFile, JSON.stringify({ ...(await exportJWK(publicKey)), kid: 'k1' }));
    for (const file of [publicFile, await privateJwkFile('nokid.jwk', { kid: undefined }), join(dir, 'absent.jwk')]) {
      vi.stubEnv('YOURTAL_OIDC_KEY_FILE', file);
      const { settings } = await load();
      expect(settings.yourtalSignInSettings()?.web).toBeUndefined();
    }
  });

  it('notices a key file copied into place after boot, within a minute, without a restart', async () => {
    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'https://yourtal.gaiada.com/oidc');
    vi.stubEnv('YOURTAL_OIDC_WEB_CLIENT_ID', 'snapapp-staging-web');
    const later = join(dir, 'later.jwk');
    vi.stubEnv('YOURTAL_OIDC_KEY_FILE', later);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
      const { settings } = await load();
      expect(settings.yourtalSignInSettings()?.web).toBeUndefined();

      const { privateKey } = await generateKeyPair('RS256', { extractable: true });
      writeFileSync(later, JSON.stringify({ ...(await exportJWK(privateKey)), kid: 'k1' }));
      // Not re-read at every request...
      vi.setSystemTime(new Date('2026-10-21T00:00:30Z'));
      expect(settings.yourtalSignInSettings()?.web).toBeUndefined();
      // ...but within a minute.
      vi.setSystemTime(new Date('2026-10-21T00:01:01Z'));
      expect(settings.yourtalSignInSettings()?.web?.clientId).toBe('snapapp-staging-web');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an http issuer or website redirect in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'http://yourtal.gaiada.com/oidc');
    let { config } = await load();
    expect(() => config.config()).toThrow(/YOURTAL_OIDC_ISSUER: must be https/);

    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'https://yourtal.gaiada.com/oidc');
    vi.stubEnv('YOURTAL_OIDC_WEB_REDIRECT_URI', 'http://snap-apps.gaiada.com/auth/yourtal/callback');
    ({ config } = await load());
    expect(() => config.config()).toThrow(/YOURTAL_OIDC_WEB_REDIRECT_URI: must be https/);
  });

  it('rejects an issuer that is not a URL', async () => {
    vi.stubEnv('YOURTAL_OIDC_ISSUER', 'yourtal');
    const { config } = await load();
    expect(() => config.config()).toThrow(/YOURTAL_OIDC_ISSUER/);
  });

  it('reads a PKCS#8 PEM too, and its public half never carries a private member', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { settings } = await load();
    const key = await settings.parsePrivateKey(pem.trim());
    expect(key.alg).toBe('RS256');
    expect(key.kid).toMatch(/^[A-Za-z0-9_-]{43}$/); // RFC 7638 thumbprint
    expect(Object.keys(key.publicJwk).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });
});
