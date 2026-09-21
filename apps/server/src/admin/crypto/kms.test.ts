import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
    const encrypted = await encryptApiKey(plaintext);
    const recovered = await decryptApiKey(encrypted.ciphertext, encrypted.wrappedDek);
    expect(recovered).toBe(plaintext);
  });

  it('the ciphertext and the wrapped DEK contain no readable trace of the plaintext', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-super-secret-marker-value-zzz';
    const encrypted = await encryptApiKey(plaintext);
    expect(encrypted.ciphertext.toString('latin1')).not.toContain(plaintext);
    expect(encrypted.ciphertext.toString('base64')).not.toContain(Buffer.from(plaintext).toString('base64'));
    expect(encrypted.wrappedDek.toString('latin1')).not.toContain(plaintext);
  });

  it('exposes only a prefix and last 4 characters — never enough to reconstruct the key', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';
    const encrypted = await encryptApiKey(plaintext);
    expect(encrypted.keyPrefix).toBe(plaintext.slice(0, 8));
    expect(encrypted.keyLast4).toBe(plaintext.slice(-4));
    expect(encrypted.keyPrefix.length + encrypted.keyLast4.length).toBeLessThan(plaintext.length);
  });

  it('two encryptions of the SAME key produce DIFFERENT ciphertext (fresh DEK, fresh IV each time)', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-identical-plaintext-twice-abcd';
    const a = await encryptApiKey(plaintext);
    const b = await encryptApiKey(plaintext);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it('refuses to decrypt under the WRONG master key — the authentication tag fails, not a silent garbage result', async () => {
    const { encryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';
    const encrypted = await encryptApiKey(plaintext);

    vi.resetModules();
    process.env.ADMIN_KMS_MASTER_KEY = '22'.repeat(32); // a different key
    const { decryptApiKey } = await import('./kms.js');
    await expect(decryptApiKey(encrypted.ciphertext, encrypted.wrappedDek)).rejects.toThrow();

    vi.resetModules();
    process.env.ADMIN_KMS_MASTER_KEY = MASTER_KEY;
  });

  it('rejects anything shorter than 8 characters — not a real API key', async () => {
    const { encryptApiKey } = await import('./kms.js');
    await expect(encryptApiKey('short')).rejects.toThrow();
  });
});

describe('admin AI-key envelope encryption — no master key configured', () => {
  it('fails loudly rather than falling back to a default', async () => {
    const original = process.env.ADMIN_KMS_MASTER_KEY;
    delete process.env.ADMIN_KMS_MASTER_KEY;
    vi.resetModules();
    const mod = await import('./kms.js');
    await expect(mod.encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).rejects.toThrow(
      /ADMIN_KMS_MASTER_KEY/,
    );
    vi.resetModules();
    if (original) process.env.ADMIN_KMS_MASTER_KEY = original;
  });
});

/**
 * FAIL CLOSED IN PRODUCTION — the KMS provider seam.
 *
 * Before this, the local env-var master key was warned about
 * (`docs/DEPLOY.md` §5, the boot preflight) but never actually refused in
 * production — a document and a log line are not a control. This proves the
 * refusal actually fires (not just that the code reads a certain way), that
 * it fires ONLY for the write path, and that development is unaffected.
 *
 * `vi.resetModules()` before each scenario: `NODE_ENV` and the cached
 * provider/master-key are both read once and cached at module scope (the
 * same "read once at startup" discipline the rest of this file already
 * relies on), so a fresh module is required for each combination of
 * `NODE_ENV`/`ADMIN_KMS_PROVIDER` to take effect.
 */
describe('admin AI-key envelope encryption — fails closed on the LOCAL KMS provider in production', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_PROVIDER = process.env.ADMIN_KMS_PROVIDER;

  beforeAll(() => {
    process.env.ADMIN_KMS_MASTER_KEY = MASTER_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_PROVIDER === undefined) delete process.env.ADMIN_KMS_PROVIDER;
    else process.env.ADMIN_KMS_PROVIDER = ORIGINAL_PROVIDER;
    vi.resetModules();
  });

  it('REFUSES to store a new key when NODE_ENV=production and the provider is (by default) local', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ADMIN_KMS_PROVIDER;
    vi.resetModules();
    const { encryptApiKey } = await import('./kms.js');
    await expect(encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).rejects.toThrow(
      /local KMS stand-in.*production/i,
    );
  });

  it('this is a genuine refusal, not a warning — no key material is produced and nothing is left to store', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { encryptApiKey } = await import('./kms.js');
    let thrown: unknown;
    try {
      await encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
  });

  it('succeeds under development with the same (local) provider', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_KMS_PROVIDER;
    vi.resetModules();
    const { encryptApiKey } = await import('./kms.js');
    const encrypted = await encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123');
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
  });

  it('succeeds when NODE_ENV is unset entirely (test runs, local scripts)', async () => {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    vi.resetModules();
    const { encryptApiKey } = await import('./kms.js');
    const encrypted = await encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123');
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
  });

  it('READING an already-stored key keeps working in production — refusing to decrypt is not this fix\'s job', async () => {
    // Encrypt under development (storing is allowed there), THEN switch to
    // production and prove decryption of that same ciphertext still works —
    // the refusal must never brick an environment that already has keys.
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const dev = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';
    const encrypted = await dev.encryptApiKey(plaintext);

    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const prod = await import('./kms.js');
    const recovered = await prod.decryptApiKey(encrypted.ciphertext, encrypted.wrappedDek);
    expect(recovered).toBe(plaintext);
  });

  it('an unknown ADMIN_KMS_PROVIDER is refused with guidance, not silently ignored', async () => {
    process.env.ADMIN_KMS_PROVIDER = 'aws';
    vi.resetModules();
    const { encryptApiKey } = await import('./kms.js');
    await expect(encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).rejects.toThrow(
      /ADMIN_KMS_PROVIDER.*not implemented/i,
    );
  });
});
