import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
 * `wrap`/`unwrap` are the two operations a real KMS exposes, and
 * `LocalKmsProvider` — a master key read from `ADMIN_KMS_MASTER_KEY` (64 hex
 * characters = 32 bytes) — is the only implementation that exists in this
 * repo. There are no AWS/GCP/Vault credentials anywhere in this codebase, and
 * a provider that pretended to call a cloud KMS with none configured would be
 * worse than an honest absence: it would look wired up while silently doing
 * nothing a real KMS does (hardware-backed key material, access logging,
 * regional key policies). So there is no `AwsKmsProvider` stub — only this
 * documented seam, selected by `ADMIN_KMS_PROVIDER` (default `"local"`), for
 * whoever wires the real one in.
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
  wrap(dek: Buffer): Buffer;
  unwrap(wrapped: Buffer): Buffer;
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
  wrap(dek: Buffer): Buffer {
    return seal(dek, masterKey());
  }
  unwrap(wrapped: Buffer): Buffer {
    return unseal(wrapped, masterKey());
  }
}

const KMS_PROVIDER_ENV = 'ADMIN_KMS_PROVIDER';

function selectProvider(): KmsProvider {
  const id = process.env[KMS_PROVIDER_ENV] ?? 'local';
  if (id === 'local') return new LocalKmsProvider();
  // A real cloud provider ('aws' | 'gcp' | 'vault', say) is not implemented —
  // there are no credentials anywhere in this repo, and a stub that pretends
  // to call one would be worse than refusing outright (see the file header).
  // Add a class implementing `KmsProvider` and a branch here when one exists;
  // until then, selecting anything but "local" is a configuration mistake,
  // not a silently-ignored setting.
  throw new Error(
    `${KMS_PROVIDER_ENV}="${id}" is not implemented. Only "local" (the env-var stand-in) exists in this ` +
      'codebase today. Implement a KmsProvider for the real KMS (see apps/server/src/admin/crypto/kms.ts) ' +
      'before selecting it here.',
  );
}

let cachedProvider: KmsProvider | null = null;

function provider(): KmsProvider {
  if (!cachedProvider) cachedProvider = selectProvider();
  return cachedProvider;
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
export function encryptApiKey(plaintext: string): EncryptedApiKey {
  if (plaintext.length < 8) {
    throw new Error('That does not look like a real API key.');
  }
  const active = provider();
  if (active.id === 'local' && isProductionEnv()) {
    throw new Error(
      'Refusing to store an AI provider key: the LOCAL KMS stand-in (a master key read from ' +
        `${MASTER_KEY_ENV}) is active in production. This wraps new secrets with an environment ` +
        'variable instead of a hardware-backed KMS, which is exactly what must not protect a live ' +
        'credential. Wire a real KmsProvider (AWS/GCP KMS, Vault) and select it with ' +
        `${KMS_PROVIDER_ENV} before storing a key in this environment — see docs/DEPLOY.md §5.`,
    );
  }
  const dek = randomBytes(32);
  const ciphertext = seal(Buffer.from(plaintext, 'utf8'), dek);
  const wrappedDek = active.wrap(dek);
  return {
    ciphertext,
    wrappedDek,
    kmsKeyId: KMS_KEY_ID,
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
export function decryptApiKey(ciphertext: Buffer, wrappedDek: Buffer): string {
  const dek = provider().unwrap(wrappedDek);
  return unseal(ciphertext, dek).toString('utf8');
}
