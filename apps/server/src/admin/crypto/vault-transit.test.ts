import { afterEach, describe, expect, it, vi } from 'vitest';

import { startVaultSimulator, type VaultSimulator } from '../../integrations/vault-simulator.js';
import { VaultKmsError, VaultTransitKmsProvider } from './vault-transit.js';

/**
 * `docs/INTEGRATIONS.md` Lane K, tickets K1 and K2.
 *
 * Every test here drives `VaultTransitKmsProvider` — the class that runs in
 * production — over real HTTP against a server that speaks Vault's Transit
 * API. Nothing is mocked. `fetch` is the real `fetch`, the JSON is real JSON,
 * and a 403 is a real 403. The only thing the simulator changes is where the
 * key material lives, which is the one difference that cannot be tested
 * without a Vault.
 *
 * That is the K2 bargain and it is worth stating plainly: when a real
 * `VAULT_ADDR` is finally set, the untested surface is the address and the
 * token, not the client.
 */

const started: VaultSimulator[] = [];

async function vault(options?: Parameters<typeof startVaultSimulator>[0]) {
  const sim = await startVaultSimulator(options);
  started.push(sim);
  return sim;
}

function providerFor(sim: VaultSimulator, overrides: Record<string, unknown> = {}) {
  return new VaultTransitKmsProvider({
    address: sim.address,
    token: sim.token,
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((s) => s.close()));
  vi.resetModules();
});

describe('VaultTransitKmsProvider, against a server that speaks Transit', () => {
  it('wraps and unwraps a DEK, recovering the exact bytes', async () => {
    const sim = await vault();
    const kms = providerFor(sim);
    const dek = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes

    const wrapped = await kms.wrap(dek);
    const recovered = await kms.unwrap(wrapped);

    expect(recovered.equals(dek)).toBe(true);
  });

  it('the wrapped DEK carries the vault:vN: prefix, and contains no trace of the key', async () => {
    // The prefix is not cosmetic — the rotation path parses it. A simulator
    // returning bare base64 would let a rotation bug ship, so this is
    // asserted rather than assumed.
    const sim = await vault();
    const kms = providerFor(sim);
    const dek = Buffer.from('a-distinctive-32-byte-dek-value!', 'utf8');

    const wrapped = await kms.wrap(dek);
    const asText = wrapped.toString('utf8');

    expect(asText.startsWith('vault:v1:')).toBe(true);
    expect(asText).not.toContain('distinctive');
    expect(wrapped.toString('latin1')).not.toContain(dek.toString('latin1'));
  });

  it('never returns the same ciphertext twice for the same DEK', async () => {
    const sim = await vault();
    const kms = providerFor(sim);
    const dek = Buffer.alloc(32, 7);

    const a = await kms.wrap(dek);
    const b = await kms.wrap(dek);

    expect(a.equals(b)).toBe(false);
  });

  it('ROTATING the KEK does not break anything already wrapped — the point of the envelope', async () => {
    // This is the property the whole envelope design exists for, claimed in
    // kms.ts's header since it was written and never once executed: rotating
    // the KEK must not require re-encrypting every stored secret.
    const sim = await vault();
    const kms = providerFor(sim);
    const dek = Buffer.alloc(32, 3);

    const wrappedUnderV1 = await kms.wrap(dek);
    expect(wrappedUnderV1.toString('utf8').startsWith('vault:v1:')).toBe(true);

    await kms.rotateKey();
    expect(sim.version()).toBe(2);

    // The old ciphertext still decrypts, under the retained v1 key...
    const recovered = await kms.unwrap(wrappedUnderV1);
    expect(recovered.equals(dek)).toBe(true);

    // ...and anything wrapped from now on is wrapped under v2.
    const wrappedUnderV2 = await kms.wrap(dek);
    expect(wrappedUnderV2.toString('utf8').startsWith('vault:v2:')).toBe(true);
    expect((await kms.unwrap(wrappedUnderV2)).equals(dek)).toBe(true);
  });

  it('a wrong token is a real 403, surfaced with Vault\'s own words', async () => {
    // The most likely production failure of this integration is an expired
    // token, so the client's handling of it should not be theoretical.
    const sim = await vault();
    const kms = providerFor(sim, { token: 's.not-the-right-token' });

    await expect(kms.wrap(Buffer.alloc(32))).rejects.toThrow(VaultKmsError);
    await expect(kms.wrap(Buffer.alloc(32))).rejects.toThrow(/403.*permission denied/);
  });

  it('an unreachable Vault is named as unreachable, not as a permission problem', async () => {
    // Two different operator responses — "the container is down" versus "the
    // token is wrong" — so they must not present as the same error.
    const sim = await vault();
    const address = sim.address;
    const token = sim.token;
    await sim.close();
    started.splice(started.indexOf(sim), 1);

    const kms = new VaultTransitKmsProvider({ address, token, timeoutMs: 1_000 });
    await expect(kms.wrap(Buffer.alloc(32))).rejects.toThrow(/could not be reached/);
    // And it says nothing was written, because nothing was.
    await expect(kms.wrap(Buffer.alloc(32))).rejects.toThrow(/nothing has been written/);
  });

  it('an unknown transit key is refused by Vault, not silently created', async () => {
    const sim = await vault();
    const kms = providerFor(sim, { keyName: 'a-key-that-was-never-created' });

    await expect(kms.wrap(Buffer.alloc(32))).rejects.toThrow(VaultKmsError);
  });

  it('REFUSES a wrapped DEK that Vault did not produce, and says why', async () => {
    // The real scenario: a DEK wrapped by the LOCAL stand-in, read back after
    // someone switched ADMIN_KMS_PROVIDER to vault. Those bytes are AES-GCM
    // output; sending them to Vault would produce a confusing 400 instead of
    // the one sentence that explains what happened.
    const sim = await vault();
    const kms = providerFor(sim);
    const localLookingWrap = Buffer.alloc(60, 9);

    await expect(kms.unwrap(localLookingWrap)).rejects.toThrow(/not produced by Vault/);
    await expect(kms.unwrap(localLookingWrap)).rejects.toThrow(/LOCAL KMS stand-in/);
  });

  it('refuses to construct without an address or a token', async () => {
    expect(() => new VaultTransitKmsProvider({ address: '', token: 't' })).toThrow(/VAULT_ADDR/);
    expect(() => new VaultTransitKmsProvider({ address: 'http://v:8200', token: '' })).toThrow(
      /VAULT_TOKEN/,
    );
  });

  it('tolerates a trailing slash on VAULT_ADDR', async () => {
    // A trailing slash in a compose file would otherwise produce `//v1/` and
    // a 404 that reads as "Vault is broken".
    const sim = await vault();
    const kms = providerFor(sim, { address: `${sim.address}/` });
    const dek = Buffer.alloc(32, 1);
    expect((await kms.unwrap(await kms.wrap(dek))).equals(dek)).toBe(true);
  });
});

/**
 * The same provider, reached the way production reaches it: through
 * `kms.ts`'s `encryptApiKey` / `decryptApiKey` with `ADMIN_KMS_PROVIDER=vault`
 * and the simulator selected by `integrations/simulation.ts`.
 */
describe('the KMS seam with ADMIN_KMS_PROVIDER=vault', () => {
  const ORIGINAL = {
    NODE_ENV: process.env.NODE_ENV,
    PROVIDER: process.env.ADMIN_KMS_PROVIDER,
    SIMULATOR: process.env.KMS_SIMULATOR,
    ADDR: process.env.VAULT_ADDR,
  };

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    for (const [key, value] of [
      ['NODE_ENV', ORIGINAL.NODE_ENV],
      ['ADMIN_KMS_PROVIDER', ORIGINAL.PROVIDER],
      ['KMS_SIMULATOR', ORIGINAL.SIMULATOR],
      ['VAULT_ADDR', ORIGINAL.ADDR],
    ] as const) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    vi.resetModules();
  });

  it('round-trips a real API key through the simulated Vault', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_KMS_PROVIDER = 'vault';
    process.env.KMS_SIMULATOR = 'true';
    delete process.env.VAULT_ADDR;
    vi.resetModules();

    const { encryptApiKey, decryptApiKey } = await import('./kms.js');
    const plaintext = 'sk-live-abcdefghijklmnopqrstuvwxyz0123';

    const encrypted = await encryptApiKey(plaintext);
    // Provenance: the stored row says a Vault key wrapped it, not `local-v1`.
    expect(encrypted.kmsKeyId).toBe('vault:transit/snap-dek');
    expect(encrypted.wrappedDek.toString('utf8').startsWith('vault:v1:')).toBe(true);

    expect(await decryptApiKey(encrypted.ciphertext, encrypted.wrappedDek)).toBe(plaintext);
  });

  it('REFUSES to store a key under the SIMULATED Vault in production', async () => {
    // Not a cryptographic objection. The simulator's key material dies with
    // the process, so a key wrapped now is unreadable after the next restart
    // — silent data loss, on exactly the kind of host where a container
    // restart is routine.
    process.env.NODE_ENV = 'production';
    process.env.DEMO_ENV = 'staging';
    process.env.ADMIN_KMS_PROVIDER = 'vault';
    process.env.KMS_SIMULATOR = 'true';
    delete process.env.VAULT_ADDR;
    vi.resetModules();

    const { encryptApiKey } = await import('./kms.js');
    await expect(encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).rejects.toThrow(
      /permanently unreadable at the next restart/,
    );

    delete (process.env as Record<string, string | undefined>).DEMO_ENV;
  });

  it('REFUSES vault with neither a real address nor the simulator — no silent fallback to local', async () => {
    // The dangerous case: configuration says "vault", reality is an
    // environment variable. A fallback here would mean production secrets
    // wrapped by ADMIN_KMS_MASTER_KEY while the config claimed otherwise.
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_KMS_PROVIDER = 'vault';
    delete process.env.KMS_SIMULATOR;
    delete process.env.VAULT_ADDR;
    vi.resetModules();

    const { encryptApiKey } = await import('./kms.js');
    await expect(encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).rejects.toThrow(
      /no fallback to the local stand-in/,
    );
  });

  it('REFUSES a real VAULT_ADDR with no VAULT_TOKEN', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_KMS_PROVIDER = 'vault';
    process.env.VAULT_ADDR = 'http://vault:8200';
    delete process.env.VAULT_TOKEN;
    vi.resetModules();

    const { encryptApiKey } = await import('./kms.js');
    await expect(encryptApiKey('sk-live-abcdefghijklmnopqrstuvwxyz0123')).rejects.toThrow(
      /VAULT_TOKEN is not/,
    );
  });
});
