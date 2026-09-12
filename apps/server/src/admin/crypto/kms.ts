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
 * material itself, only wrap/unwrap operations. `wrapDek`/`unwrapDek` below
 * are the two functions that change when this moves from the local stand-in
 * to a real KMS call; nothing else in this file or in `admin.repo.ts` would.
 *
 * THE LOCAL STAND-IN. There is no cloud KMS wired into this repo yet, so the
 * "KMS" here is a master key read from `ADMIN_KMS_MASTER_KEY` (64 hex
 * characters = 32 bytes), validated eagerly the first time this module is
 * touched — the same "no secret defaults, fail at startup" discipline
 * `apps/server/src/config.ts` applies, kept out of that shared module
 * deliberately (see this migration's owning agent's report: `config.ts` and
 * `tokens.ts` were being edited concurrently by other agents while this was
 * written, and this plane does not need to touch either). Replacing this
 * with a real KMS is an operational requirement before this ships to
 * production with real provider keys — see the report's risk list.
 */

const MASTER_KEY_ENV = 'ADMIN_KMS_MASTER_KEY';
/** Identifies which master key epoch wrapped a given DEK, for rotation. */
export const KMS_KEY_ID = process.env.ADMIN_KMS_KEY_ID ?? 'local-v1';

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

/** Wraps a fresh DEK under the master key. This is the KMS `Encrypt` call. */
function wrapDek(dek: Buffer): Buffer {
  return seal(dek, masterKey());
}

/** Unwraps a DEK. This is the KMS `Decrypt` call. */
function unwrapDek(wrapped: Buffer): Buffer {
  return unseal(wrapped, masterKey());
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
 */
export function encryptApiKey(plaintext: string): EncryptedApiKey {
  if (plaintext.length < 8) {
    throw new Error('That does not look like a real API key.');
  }
  const dek = randomBytes(32);
  const ciphertext = seal(Buffer.from(plaintext, 'utf8'), dek);
  const wrappedDek = wrapDek(dek);
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
 */
export function decryptApiKey(ciphertext: Buffer, wrappedDek: Buffer): string {
  const dek = unwrapDek(wrappedDek);
  return unseal(ciphertext, dek).toString('utf8');
}
