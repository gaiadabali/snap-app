import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { simulationMode } from '../../integrations/simulation.js';
import { startVaultSimulator } from '../../integrations/vault-simulator.js';
import { VaultTransitKmsProvider } from './vault-transit.js';

/**
 * Envelope encryption for platform AI provider keys.
 *
 * `docs/PLAN.md` §7 specifies this exact pattern for bank details, and
 * `packages/db/migrations/0021_admin_plane.sql`'s header applies it to AI
 * keys for the same reason: NOT `pgcrypto`, because a key passed as SQL text
 * lands in the Postgres log and in `pg_stat_statements`. So the plaintext key
 * never crosses into SQL at all — it is encrypted here, in Node, before
 * `admin_ai_key_store` ever sees it, and that function's own parameters are
 * opaque `bytea`.
 *
 * ENVELOPE, not a single key: each stored secret gets its own random Data
 * Encryption Key (DEK), and the DEK itself is wrapped by a master key (the
 * KEK). Two reasons this is worth the extra layer over "just encrypt with
 * one key": rotating the KEK never requires re-encrypting every stored
 * secret (only re-wrapping their DEKs), and a KEK is exactly the boundary a
 * real KMS (AWS KMS, GCP KMS, Vault) draws — it never releases the key
 * material itself, only wrap/unwrap operations.
 *
 * THE PROVIDER SEAM. `KmsProvider` below is that boundary made explicit:
 * `wrap`/`unwrap` are the two operations a real KMS exposes. Two
 * implementations exist, selected by `ADMIN_KMS_PROVIDER` (default
 * `"local"`):
 *
 *   local  — a master key read from `ADMIN_KMS_MASTER_KEY` (64 hex
 *            characters = 32 bytes). The correct SHAPE, not a real KMS, and
 *            refused for WRITES in production (below).
 *   vault  — `crypto/vault-transit.ts`, HashiCorp Vault's Transit engine.
 *            Real: key material never leaves Vault, every call is
 *            authenticated and logged, and the KEK rotates without
 *            re-encrypting anything already wrapped.
 *
 * AWS and GCP are still absent, and the original reasoning for their absence
 * stands unchanged: a provider that pretended to call a cloud KMS with no
 * credentials would be worse than an honest absence, because it would look
 * wired up while doing none of what a real KMS does. There is no
 * `AwsKmsProvider` stub.
 *
 * WHAT ABOUT THE VAULT SIMULATOR, THEN? It is not a stub in that sense, and
 * the difference is the whole argument of `docs/INTEGRATIONS.md` §0: it is
 * an HTTP server that speaks Vault's Transit API, so the provider talking to
 * it is `VaultTransitKmsProvider` — the same class, making the same calls,
 * parsing the same JSON, handling the same 403s — and not a second
 * implementation that shortcuts them. Nothing "pretends" to call a KMS: a
 * real call is made to something that answers like one. It is triple-gated
 * by `integrations/simulation.ts`, and `encryptApiKey` refuses it in
 * production for a reason that has nothing to do with cryptography — see the
 * second refusal in that function.
 *
 * FAIL CLOSED IN PRODUCTION — this is the part that changed. Until now,
 * `docs/DEPLOY.md` §5 and the boot preflight (`apps/server/src/preflight.ts`)
 * only WARNED that the local stand-in should not protect a live provider
 * credential in production; nothing stopped it from doing exactly that. A
 * warning in a document or a boot log is not a control — this project has
 * already shipped two other bugs of that exact shape (the dev sign-in bypass
 * whose own comment said "must not ship" but nothing enforced it, and the
 * DeepSeek chat exclusion that lived only in a doc while the router happily
 * used the model anyway). So `encryptApiKey` — the WRITE path, called only
 * when a staff member stores or rotates a key through the admin UI — now
 * THROWS if the active provider is `local` and `NODE_ENV=production`, rather
 * than warning. `decryptApiKey` — the READ path for an already-stored key —
 * is deliberately NOT gated the same way: refusing to decrypt would brick any
 * environment that already has keys wrapped by the local stand-in, which is
 * not this fix's job. The risk this closes is NEW secrets being protected by
 * an environment variable in production; it is not "make the KMS stand-in
 * silently stop working".
 *
 * This reads `process.env.NODE_ENV` directly rather than importing
 * `isProduction()` from `../../config.js`: `config()` validates its ENTIRE
 * schema (including `DATABASE_URL`) the first time anything calls it, and
 * `kms.test.ts` is a standalone unit suite with no database dependency at
 * all — pulling in `config.ts` here would make that suite start requiring a
 * full server environment to even import this file, which is exactly the
 * "kept out of that shared module deliberately" reasoning this file already
 * documented before this change (and why `ADMIN_KMS_MASTER_KEY`/
 * `ADMIN_KMS_PROVIDER` are read directly from `process.env` below rather than
 * added to `config.ts`'s schema).
 */

const MASTER_KEY_ENV = 'ADMIN_KMS_MASTER_KEY';
/** Identifies which master key epoch wrapped a given DEK, for rotation. */
export const KMS_KEY_ID = process.env.ADMIN_KMS_KEY_ID ?? 'local-v1';

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

let cachedMasterKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const hex = process.env[MASTER_KEY_ENV];
  if (!hex) {
    throw new Error(
      `${MASTER_KEY_ENV} is required to store or read an AI provider key (64 hex characters = 32 bytes). ` +
        'There is no default — a development fallback here is how a development key ends up wrapping production secrets.',
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(`${MASTER_KEY_ENV} must decode to exactly 32 bytes; got ${key.length}.`);
  }
  cachedMasterKey = key;
  return cachedMasterKey;
}

const IV_LEN = 12;
const TAG_LEN = 16;

/** AES-256-GCM, output as `iv || authTag || ciphertext` — one opaque blob. */
function seal(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function unseal(sealed: Buffer, key: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_LEN);
  const tag = sealed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = sealed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * The boundary a real KMS draws: wrap/unwrap a DEK, never release key
 * material itself. `id` names which provider produced a given wrap, for
 * whatever comes after `LocalKmsProvider` — kept deliberately separate from
 * `KMS_KEY_ID` above, which names the KEY EPOCH within one provider (its
 * rotation), not which provider is active.
 */
export interface KmsProvider {
  readonly id: string;
  /**
   * What `kms_key_id` should record for a key this provider wrapped. Optional
   * because the local stand-in has only the one epoch (`KMS_KEY_ID`), while
   * Vault names a mount and a key.
   */
  readonly keyId?: string;
  wrap(dek: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

/**
 * The only provider that exists in this repo. Wraps a DEK under a master key
 * read from an environment variable — the correct SHAPE (AEAD, envelope
 * encryption) but not a hardware-backed KMS, which is exactly why
 * `encryptApiKey` refuses to use this one in production (see the file
 * header). `wrap`/`unwrap` are the two calls a real provider (AWS KMS, GCP
 * KMS, Vault transit) would make over the network instead of computing
 * locally; nothing else in this file or in `admin.repo.ts` changes when one
 * is added.
 */
class LocalKmsProvider implements KmsProvider {
  readonly id = 'local';
  // Computed locally and instantly; `async` only because the INTERFACE is
  // async. See `selectProvider` for why it had to become so.
  async wrap(dek: Buffer): Promise<Buffer> {
    return seal(dek, masterKey());
  }
  async unwrap(wrapped: Buffer): Promise<Buffer> {
    return unseal(wrapped, masterKey());
  }
}

const KMS_PROVIDER_ENV = 'ADMIN_KMS_PROVIDER';

/**
 * WHY THIS WHOLE SEAM BECAME ASYNC — `docs/INTEGRATIONS.md` Lane K, K1.
 *
 * `KmsProvider` was declared synchronous, and its own comment said
 * `wrap`/`unwrap` are "the two calls a real provider (AWS KMS, GCP KMS,
 * Vault transit) would make OVER THE NETWORK instead of computing locally".
 * Those two statements cannot both hold. The seam anticipated a network call
 * and then gave it a signature no network call can satisfy, so the first
 * real provider was always going to force this change — the local stand-in
 * being the only implementation is what kept it hidden.
 *
 * It is a small, contained break (one production caller,
 * `admin/ai.controller.ts`), and it is worth taking now rather than when
 * Lane Y stores a Xero refresh token through the same envelope.
 */
function buildProvider(id: string): KmsProvider | Promise<KmsProvider> {
  if (id === 'local') return new LocalKmsProvider();

  if (id === 'vault') {
    const mode = simulationMode('kms');

    if (mode === 'real') {
      const token = process.env.VAULT_TOKEN;
      if (!token) {
        throw new Error(
          'ADMIN_KMS_PROVIDER="vault" and VAULT_ADDR is set, but VAULT_TOKEN is not. Vault ' +
            'authenticates every request; without a token every wrap and unwrap is a 403.',
        );
      }
      return new VaultTransitKmsProvider({
        address: process.env.VAULT_ADDR!,
        token,
        mount: process.env.VAULT_TRANSIT_MOUNT,
        keyName: process.env.VAULT_TRANSIT_KEY,
      });
    }

    if (mode === 'simulated') {
      // The simulator is an HTTP SERVER speaking Vault's Transit API, and the
      // provider pointed at it is the same `VaultTransitKmsProvider` a real
      // deployment uses — not a second implementation. That is the whole
      // distinction `docs/INTEGRATIONS.md` §0 draws, and it is why this
      // branch constructs the real class rather than something else.
      return startVaultSimulator().then(
        (sim) =>
          new VaultTransitKmsProvider({
            address: sim.address,
            token: sim.token,
            mount: process.env.VAULT_TRANSIT_MOUNT,
            keyName: process.env.VAULT_TRANSIT_KEY,
          }),
      );
    }

    // `absent`: vault was selected, no VAULT_ADDR, and no permitted opt-in to
    // the simulator. Refused rather than silently falling back to `local`,
    // because a silent fallback here means production secrets wrapped by an
    // environment variable while the configuration says otherwise.
    throw new Error(
      'ADMIN_KMS_PROVIDER="vault" but no Vault is configured and the simulator is not enabled. ' +
        'Set VAULT_ADDR and VAULT_TOKEN to use a real Vault, or KMS_SIMULATOR=true on a ' +
        'non-production host (or one with DEMO_ENV=staging) to run against the in-process ' +
        'Transit simulator. There is deliberately no fallback to the local stand-in.',
    );
  }

  // AWS and GCP remain unimplemented, and the original reasoning stands: a
  // stub that pretended to call one would be worse than refusing outright.
  throw new Error(
    `${KMS_PROVIDER_ENV}="${id}" is not implemented. "local" (the env-var stand-in) and "vault" ` +
      '(HashiCorp Vault Transit) exist in this codebase. Implement a KmsProvider for the real KMS ' +
      '(see apps/server/src/admin/crypto/vault-transit.ts for the shape) before selecting it here.',
  );
}

let cachedProvider: Promise<KmsProvider> | null = null;

function provider(): Promise<KmsProvider> {
  if (!cachedProvider) {
    // Memoised as a PROMISE, not as a resolved value: two concurrent
    // requests must not each start their own simulator or build their own
    // client. Cleared on rejection so a transient misconfiguration does not
    // poison the process for its lifetime.
    cachedProvider = Promise.resolve()
      .then(() => buildProvider(process.env[KMS_PROVIDER_ENV] ?? 'local'))
      .catch((error: unknown) => {
        cachedProvider = null;
        throw error;
      });
  }
  return cachedProvider;
}

/** Test-only: drop the memoised provider so the next call re-reads the env. */
export function resetKmsProviderForTesting(): void {
  cachedProvider = null;
}

export interface EncryptedApiKey {
  ciphertext: Buffer;
  wrappedDek: Buffer;
  kmsKeyId: string;
  /** Safe to display. Never enough to reconstruct the key. */
  keyPrefix: string;
  keyLast4: string;
}

/**
 * Encrypts a plaintext API key for storage via `admin_ai_key_store`.
 *
 * Called exactly once per key, at the moment a staff member submits it
 * through `POST /v1/admin/ai/providers/:configId/key`. The plaintext never
 * exists anywhere else in this process after this function returns.
 *
 * FAILS CLOSED in production if the active KMS provider is the local
 * env-var stand-in — see the file header for why this is a hard refusal, not
 * a warning, and why it only gates WRITING a new secret rather than reading
 * one already stored.
 */
export async function encryptApiKey(plaintext: string): Promise<EncryptedApiKey> {
  if (plaintext.length < 8) {
    throw new Error('That does not look like a real API key.');
  }
  const active = await provider();
  if (active.id === 'local' && isProductionEnv()) {
    throw new Error(
      'Refusing to store an AI provider key: the LOCAL KMS stand-in (a master key read from ' +
        `${MASTER_KEY_ENV}) is active in production. This wraps new secrets with an environment ` +
        'variable instead of a hardware-backed KMS, which is exactly what must not protect a live ' +
        'credential. Wire a real KmsProvider (AWS/GCP KMS, Vault) and select it with ' +
        `${KMS_PROVIDER_ENV} before storing a key in this environment — see docs/DEPLOY.md §5.`,
    );
  }

  // The same refusal, for the case the original could not have anticipated:
  // a SIMULATED Vault on a production-NODE_ENV demo host.
  //
  // This is not the usual "a simulator is less secure" objection. The
  // simulator's key material is `randomBytes(32)` in this process's memory
  // and dies with the process — so a key wrapped by it is not weakly
  // protected, it is UNRECOVERABLE after the next restart, and the loss is
  // silent until someone tries to read it. A demo host is exactly where a
  // container restart is routine.
  //
  // Reading an already-stored key stays ungated, same as above and for the
  // same reason.
  if (simulationMode('kms') === 'simulated' && isProductionEnv()) {
    throw new Error(
      'Refusing to store an AI provider key: the KMS is the in-process Vault SIMULATOR. Its key ' +
        'material lives in this process and dies with it, so anything wrapped now becomes ' +
        'permanently unreadable at the next restart — a silent data loss, not a weak cipher. ' +
        'Point VAULT_ADDR at a real Vault before storing a key on this host.',
    );
  }

  const dek = randomBytes(32);
  const ciphertext = seal(Buffer.from(plaintext, 'utf8'), dek);
  const wrappedDek = await active.wrap(dek);
  return {
    ciphertext,
    wrappedDek,
    // The provider names its own key where it can (Vault: mount + key name);
    // the local stand-in has only the one epoch, so it falls back to the
    // module constant. Provenance, so a stored row says what wrapped it.
    kmsKeyId: active.keyId ?? KMS_KEY_ID,
    keyPrefix: plaintext.slice(0, 8),
    keyLast4: plaintext.slice(-4),
  };
}

/**
 * Decrypts a stored key back to plaintext.
 *
 * NEVER CALL THIS FROM A CONTROLLER OR ANY CODE PATH THAT RETURNS TO THE
 * CLIENT. Its only legitimate caller is the extraction pipeline reading the
 * live provider key it needs to make a model call — and wiring that up is
 * explicitly out of this migration's scope (see the report). Nothing in
 * `apps/server/src/admin` calls this; it exists so that future caller has a
 * correct, tested place to do it, rather than reinventing envelope
 * decryption next to a raw `ciphertext` column read.
 *
 * Deliberately NOT gated by `isProductionEnv()`: an already-stored key was
 * wrapped by whatever provider was active when it was written, and refusing
 * to unwrap it in production would brick every environment that already has
 * one — the risk this file closes is new secrets being written under the
 * local stand-in, not reading what is already there.
 */
export async function decryptApiKey(ciphertext: Buffer, wrappedDek: Buffer): Promise<string> {
  const dek = await (await provider()).unwrap(wrappedDek);
  return unseal(ciphertext, dek).toString('utf8');
}
