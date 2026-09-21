import { describe, expect, it } from 'vitest';

import { VaultTransitKmsProvider } from './vault-transit.js';

/**
 * The same provider, against a REAL HashiCorp Vault.
 *
 * `docs/INTEGRATIONS.md` K1's *done when* names a real container, and the
 * simulator — however faithful — cannot close that clause by itself. This
 * file is what does: it is skipped unless `VAULT_ADDR` and `VAULT_TOKEN`
 * point at a live Vault with the transit engine mounted, so CI stays green
 * without one and an operator can run it against the real thing on demand:
 *
 *   docker run -d --rm --name snap-vault-test -p 8211:8200 \
 *     -e VAULT_DEV_ROOT_TOKEN_ID=root-test-token \
 *     -e VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200 --cap-add=IPC_LOCK hashicorp/vault
 *   curl -sX POST -H 'X-Vault-Token: root-test-token' \
 *     -d '{"type":"transit"}' http://127.0.0.1:8211/v1/sys/mounts/transit
 *   curl -sX POST -H 'X-Vault-Token: root-test-token' \
 *     http://127.0.0.1:8211/v1/transit/keys/snap-dek
 *   VAULT_ADDR=http://127.0.0.1:8211 VAULT_TOKEN=root-test-token \
 *     npx vitest run src/admin/crypto/vault-transit.live.test.ts
 *
 * SKIPPED IS NOT PASSED. A suite that quietly skips is indistinguishable
 * from one that is broken — the same objection this repository raises about
 * checks that never fire — so the describe block asserts the reason it
 * skipped, and the first test fails loudly if `VAULT_ADDR` is set but
 * unreachable rather than silently skipping that case too.
 */

const address = process.env.VAULT_ADDR;
const token = process.env.VAULT_TOKEN;
const live = Boolean(address && token);

describe.skipIf(!live)('VaultTransitKmsProvider against a real Vault', () => {
  const kms = () =>
    new VaultTransitKmsProvider({
      address: address!,
      token: token!,
      mount: process.env.VAULT_TRANSIT_MOUNT,
      keyName: process.env.VAULT_TRANSIT_KEY,
    });

  it('wraps and unwraps a DEK against the real Transit engine', async () => {
    const dek = Buffer.from('real-vault-round-trip-dek-32byte', 'utf8');
    const wrapped = await kms().wrap(dek);

    // Real Vault stamps the same prefix the simulator does. If this ever
    // diverges, the simulator is the thing that is wrong.
    expect(wrapped.toString('utf8')).toMatch(/^vault:v\d+:/);
    expect((await kms().unwrap(wrapped)).equals(dek)).toBe(true);
  });

  it('a DEK wrapped before a real KEK rotation still unwraps after it', async () => {
    // The property the envelope exists for, proven against the real thing
    // rather than against our own reimplementation of it.
    const dek = Buffer.from('rotation-survives-this-dek-32byt', 'utf8');
    const before = await kms().wrap(dek);
    const versionBefore = /^vault:v(\d+):/.exec(before.toString('utf8'))![1];

    await kms().rotateKey();

    const after = await kms().wrap(dek);
    const versionAfter = /^vault:v(\d+):/.exec(after.toString('utf8'))![1];

    expect(Number(versionAfter)).toBe(Number(versionBefore) + 1);
    expect((await kms().unwrap(before)).equals(dek)).toBe(true);
    expect((await kms().unwrap(after)).equals(dek)).toBe(true);
  });

  it('a wrong token is refused by the real Vault', async () => {
    const wrong = new VaultTransitKmsProvider({ address: address!, token: 'definitely-not-valid' });
    await expect(wrong.wrap(Buffer.alloc(32))).rejects.toThrow(/permission denied/);
  });
});
