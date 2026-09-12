import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * `encryptApiKey`/`decryptApiKey` — envelope encryption for AI provider keys.
 *
 * This is NOT a happy-path-only suite: the two properties that actually
 * matter for a stored secret are that (a) round-tripping recovers the exact
 * plaintext, and (b) the ciphertext and the wrapped DEK contain no trace of
 * it — a stored row must be safe to leak. Both are asserted directly rather
 * than assumed from "the function returned no error". `vi.resetModules()` is
 * used throughout so each scenario gets a fresh, uncached master key — this
 * module deliberately caches it once per process, the same "read once at
 * startup" discipline `apps/server/src/config.ts` uses.
 */
const MASTER_KEY = '11'.repeat(32); // 32 bytes hex — fixed for reproducible tests, not production key material.

describe('admin AI-key envelope encryption', () => {
  beforeAll(() => {
    process.env.ADMIN_KMS_MASTER_KEY = MASTER_KEY;
  });

  it('round-trips the exact plaintext', async () => {
    const { encryptApiKey, decryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';
    const encrypted = encryptApiKey(plaintext);
    const recovered = decryptApiKey(encrypted.ciphertext, encrypted.wrappedDek);
    expect(recovered).toBe(plaintext);
  });

  it('the ciphertext and the wrapped DEK contain no readable trace of the plaintext', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-super-secret-marker-value-zzz';
    const encrypted = encryptApiKey(plaintext);
    expect(encrypted.ciphertext.toString('latin1')).not.toContain(plaintext);
    expect(encrypted.ciphertext.toString('base64')).not.toContain(Buffer.from(plaintext).toString('base64'));
    expect(encrypted.wrappedDek.toString('latin1')).not.toContain(plaintext);
  });

  it('exposes only a prefix and last 4 characters — never enough to reconstruct the key', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';
    const encrypted = encryptApiKey(plaintext);
    expect(encrypted.keyPrefix).toBe(plaintext.slice(0, 8));
    expect(encrypted.keyLast4).toBe(plaintext.slice(-4));
    expect(encrypted.keyPrefix.length + encrypted.keyLast4.length).toBeLessThan(plaintext.length);
  });

  it('two encryptions of the SAME key produce DIFFERENT ciphertext (fresh DEK, fresh IV each time)', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-identical-plaintext-twice-abcd';
    const a = encryptApiKey(plaintext);
    const b = encryptApiKey(plaintext);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it('refuses to decrypt under the WRONG master key — the authentication tag fails, not a silent garbage result', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';
    const encrypted = encryptApiKey(plaintext);

    vi.resetModules();
    process.env.ADMIN_KMS_MASTER_KEY = '22'.repeat(32); // a different key
    const { decryptApiKey } = await import('./kms.js');
    expect(() => decryptApiKey(encrypted.ciphertext, encrypted.wrappedDek)).toThrow();

    vi.resetModules();
    process.env.ADMIN_KMS_MASTER_KEY = MASTER_KEY;
  });

  it('rejects anything shorter than 8 characters — not a real API key', async () => {
    const { encryptApiKey } = await import('./kms.js');
    expect(() => encryptApiKey('short')).toThrow();
  });
});

describe('admin AI-key envelope encryption — no master key configured', () => {
  it('fails loudly rather than falling back to a default', async () => {
    const original = process.env.ADMIN_KMS_MASTER_KEY;
    delete process.env.ADMIN_KMS_MASTER_KEY;
    vi.resetModules();
    const mod = await import('./kms.js');
    expect(() => mod.encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).toThrow(
      /ADMIN_KMS_MASTER_KEY/,
    );
    vi.resetModules();
    if (original) process.env.ADMIN_KMS_MASTER_KEY = original;
  });
});
