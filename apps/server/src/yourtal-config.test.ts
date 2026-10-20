import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The YourTal settings (tickets 1.4.b and 2.3.a). `config()` caches its
 * environment once per module instance, so every test resets the module graph
 * and imports a fresh copy after stubbing the environment.
 */
async function load() {
  vi.resetModules();
  return import('./config.js');
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  vi.stubEnv('TOKEN_SECRET', 'test-only-secret-at-least-32-characters-long');
  for (const name of [
    'YOURTAL_WEB_URL',
    'YOURTAL_API_URL',
    'YOURTAL_PARTNER_ID',
    'YOURTAL_PARTNER_SECRET',
    'YOURTAL_RECEIPT_REF_KEY',
    'YOURTAL_ENV_FILE',
  ]) {
    vi.stubEnv(name, '');
    delete process.env[name];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('YourTal settings', () => {
  it('boots with none of them set, using the staging origins and no partner link', async () => {
    const c = await load();
    const cfg = c.config();
    expect(cfg.YOURTAL_WEB_URL).toBe('https://yourtal.gaiada.com');
    expect(cfg.YOURTAL_API_URL).toBe('https://yourtal.gaiada.com');
    expect(cfg.YOURTAL_PARTNER_ID).toBeUndefined();
    expect(c.yourtalPartnerSecret()).toBeUndefined();
    expect(c.isYourtalPartnerConfigured()).toBe(false);
  });

  it('strips a trailing slash so callers can append a path', async () => {
    vi.stubEnv('YOURTAL_WEB_URL', 'https://yourtal.example/');
    vi.stubEnv('YOURTAL_API_URL', 'https://api.yourtal.example//');
    const c = await load();
    expect(c.yourtalWebUrl()).toBe('https://yourtal.example');
    expect(c.yourtalApiUrl()).toBe('https://api.yourtal.example');
  });

  it('rejects a web URL that is not a URL', async () => {
    vi.stubEnv('YOURTAL_WEB_URL', 'yourtal');
    const c = await load();
    expect(() => c.config()).toThrow(/YOURTAL_WEB_URL/);
  });

  it('reads the partner secret from the host secrets file, matched by name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yt-secret-'));
    const file = join(dir, 'yourtal.env');
    writeFileSync(
      file,
      'OPENROUTER_API_KEY=sk-or-other\nYOURTAL_PARTNER_SECRET="partner-secret-from-file"\n',
    );
    vi.stubEnv('YOURTAL_ENV_FILE', file);
    vi.stubEnv('YOURTAL_PARTNER_ID', 'snap-app');
    const c = await load();
    expect(c.yourtalPartnerSecret()).toBe('partner-secret-from-file');
    expect(c.isYourtalPartnerConfigured()).toBe(true);
  });

  it('prefers the environment, and stays off with an id but no secret', async () => {
    vi.stubEnv('YOURTAL_PARTNER_ID', 'snap-app');
    let c = await load();
    expect(c.isYourtalPartnerConfigured()).toBe(false);

    vi.stubEnv('YOURTAL_PARTNER_SECRET', 'partner-secret-from-env');
    c = await load();
    expect(c.yourtalPartnerSecret()).toBe('partner-secret-from-env');
    expect(c.isYourtalPartnerConfigured()).toBe(true);
  });

  it('treats an unreadable secrets file as not configured, not as a crash', async () => {
    vi.stubEnv('YOURTAL_ENV_FILE', join(tmpdir(), 'does-not-exist-yt.env'));
    const c = await load();
    expect(c.yourtalPartnerSecret()).toBeUndefined();
  });

  describe('the receipt ref key', () => {
    const KEY = 'k'.repeat(40);

    it('is unset by default', async () => {
      const c = await load();
      expect(c.yourtalReceiptRefKey()).toBeUndefined();
    });

    it('is read from the environment', async () => {
      vi.stubEnv('YOURTAL_RECEIPT_REF_KEY', ` ${KEY} `);
      const c = await load();
      expect(c.yourtalReceiptRefKey()).toBe(KEY);
    });

    it('is read from the host secrets file, matched by name, next to the partner secret', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'yt-refkey-'));
      const file = join(dir, 'yourtal.env');
      writeFileSync(file, `YOURTAL_PARTNER_SECRET=partner-secret
YOURTAL_RECEIPT_REF_KEY="${KEY}"
`);
      vi.stubEnv('YOURTAL_ENV_FILE', file);
      const c = await load();
      expect(c.yourtalReceiptRefKey()).toBe(KEY);
      expect(c.yourtalPartnerSecret()).toBe('partner-secret');
    });

    it('prefers the environment over the file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'yt-refkey-'));
      const file = join(dir, 'yourtal.env');
      writeFileSync(file, `YOURTAL_RECEIPT_REF_KEY=${'f'.repeat(40)}
`);
      vi.stubEnv('YOURTAL_ENV_FILE', file);
      vi.stubEnv('YOURTAL_RECEIPT_REF_KEY', KEY);
      const c = await load();
      expect(c.yourtalReceiptRefKey()).toBe(KEY);
    });

    it('counts as unset under 32 characters, in either place', async () => {
      vi.stubEnv('YOURTAL_RECEIPT_REF_KEY', 'k'.repeat(31));
      let c = await load();
      expect(c.yourtalReceiptRefKey()).toBeUndefined();

      vi.stubEnv('YOURTAL_RECEIPT_REF_KEY', '');
      const dir = mkdtempSync(join(tmpdir(), 'yt-refkey-'));
      const file = join(dir, 'yourtal.env');
      writeFileSync(file, `YOURTAL_RECEIPT_REF_KEY=${'k'.repeat(31)}
`);
      vi.stubEnv('YOURTAL_ENV_FILE', file);
      c = await load();
      expect(c.yourtalReceiptRefKey()).toBeUndefined();

      writeFileSync(file, `YOURTAL_RECEIPT_REF_KEY=${'k'.repeat(32)}
`);
      expect(c.yourtalReceiptRefKey()).toBe('k'.repeat(32));
    });
  });
});
