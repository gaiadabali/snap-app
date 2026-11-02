import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The merchant (voucher API) credential settings. `config()` caches its
 * environment once per module instance, so every test imports a fresh copy.
 */
async function load() {
  vi.resetModules();
  return import('../config.js');
}

const KEY_ID = 'mc_0b6f4d3e-5a52-4a9e-9d58-6b0d7f3a2c11';
const HEX = 'ab'.repeat(32);

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
  vi.stubEnv('TOKEN_SECRET', 'test-only-secret-at-least-32-characters-long');
  for (const name of [
    'YOURTAL_PARTNER_ID',
    'YOURTAL_PARTNER_SECRET',
    'YOURTAL_MERCHANT_KEY_ID',
    'YOURTAL_MERCHANT_SECRET',
    'YOURTAL_ENV_FILE',
  ]) {
    vi.stubEnv(name, '');
    delete process.env[name];
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function secretFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yt-merchant-'));
  const file = join(dir, 'yourtal.env');
  writeFileSync(file, text);
  return file;
}

describe('the merchant credential', () => {
  it('is unset by default, and the voucher feature is off', async () => {
    const c = await load();
    expect(c.yourtalMerchantCredential()).toBeUndefined();
    expect(c.isYourtalVoucherConfigured()).toBe(false);
  });

  it('is read from the environment as a key id and 32 raw bytes', async () => {
    vi.stubEnv('YOURTAL_MERCHANT_KEY_ID', ` ${KEY_ID} `);
    vi.stubEnv('YOURTAL_MERCHANT_SECRET', HEX);
    const c = await load();
    const credential = c.yourtalMerchantCredential();
    expect(credential?.keyId).toBe(KEY_ID);
    expect(credential?.secret).toEqual(Buffer.alloc(32, 0xab));
  });

  it('is read from the host secrets file by name, next to the partner secret', async () => {
    vi.stubEnv(
      'YOURTAL_ENV_FILE',
      secretFile(`YOURTAL_PARTNER_SECRET=p\nYOURTAL_MERCHANT_KEY_ID="${KEY_ID}"\nYOURTAL_MERCHANT_SECRET=${HEX}\n`),
    );
    const c = await load();
    expect(c.yourtalMerchantCredential()?.keyId).toBe(KEY_ID);
    expect(c.yourtalMerchantCredential()?.secret.length).toBe(32);
  });

  it('prefers the environment over the file, per setting', async () => {
    const otherKey = 'mc_11111111-2222-4333-8444-555555555555';
    vi.stubEnv('YOURTAL_ENV_FILE', secretFile(`YOURTAL_MERCHANT_KEY_ID=${KEY_ID}\nYOURTAL_MERCHANT_SECRET=${HEX}\n`));
    vi.stubEnv('YOURTAL_MERCHANT_KEY_ID', otherKey);
    const c = await load();
    expect(c.yourtalMerchantCredential()?.keyId).toBe(otherKey);
  });

  it('is voucher-configured only with the partner link AND the credential', async () => {
    vi.stubEnv('YOURTAL_MERCHANT_KEY_ID', KEY_ID);
    vi.stubEnv('YOURTAL_MERCHANT_SECRET', HEX);
    let c = await load();
    expect(c.isYourtalVoucherConfigured()).toBe(false);

    vi.stubEnv('YOURTAL_PARTNER_ID', 'snap-app');
    vi.stubEnv('YOURTAL_PARTNER_SECRET', 'partner-secret');
    c = await load();
    expect(c.isYourtalVoucherConfigured()).toBe(true);

    vi.stubEnv('YOURTAL_MERCHANT_SECRET', '');
    delete process.env.YOURTAL_MERCHANT_SECRET;
    c = await load();
    expect(c.isYourtalVoucherConfigured()).toBe(false);
  });

  it('counts a malformed value as unset and warns once per process, without the value', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = `not-hex-${'z'.repeat(56)}`;
    vi.stubEnv('YOURTAL_MERCHANT_KEY_ID', KEY_ID);
    vi.stubEnv('YOURTAL_MERCHANT_SECRET', bad);
    const c = await load();
    expect(c.yourtalMerchantCredential()).toBeUndefined();
    expect(c.yourtalMerchantCredential()).toBeUndefined();
    expect(c.isYourtalVoucherConfigured()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('YOURTAL_MERCHANT_SECRET');
    expect(message).not.toContain(bad);
    expect(message).not.toContain(KEY_ID);
  });

  it('refuses a short hex secret and a key id that is not mc_<uuid>', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('YOURTAL_MERCHANT_KEY_ID', KEY_ID);
    vi.stubEnv('YOURTAL_MERCHANT_SECRET', 'ab'.repeat(31));
    let c = await load();
    expect(c.yourtalMerchantCredential()).toBeUndefined();

    vi.stubEnv('YOURTAL_MERCHANT_KEY_ID', 'key_live_1');
    vi.stubEnv('YOURTAL_MERCHANT_SECRET', HEX);
    c = await load();
    expect(c.yourtalMerchantCredential()).toBeUndefined();
  });
});
