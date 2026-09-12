import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { config } from './config.js';

/**
 * The original bytes, kept exactly as captured.
 *
 * A local directory standing in for object storage. The client contract is the
 * same either way — it is handed a URL and PUTs bytes to it — so replacing
 * this with S3 changes this file and nothing above it.
 *
 * Two rules that are not negotiable, whichever backend is behind it:
 *
 *  1. Bytes are written ONCE and never modified. Under the ATO's rules an
 *     electronic copy of a receipt is only acceptable if it is a true and
 *     clear reproduction, so the original is the legal record. Anything the
 *     pipeline needs — deskewed, downscaled, EXIF-stripped for the model — is
 *     a separate derivative with its own key.
 *  2. The key is derived from the tenant and the content hash, so one tenant
 *     can never address another's object even if it guesses the id.
 */

export type StoredObject = { key: string; sha256: string; byteSize: number };

function root(): string {
  return resolve(config().STORAGE_DIR);
}

/**
 * Where an original lives.
 *
 * Sharded by the first two hex characters. A single directory with a hundred
 * thousand files in it is slow to list on every filesystem worth naming.
 */
export function originalKey(tenantId: string, sha256: string): string {
  return `${tenantId}/originals/${sha256.slice(0, 2)}/${sha256}`;
}

export function put(tenantId: string, bytes: Buffer): StoredObject {
  // Hashed from the bytes actually received. The client sends its own hash so
  // the server can answer "you already have this" before an upload, but the
  // authoritative hash is this one — a client-supplied hash must never decide
  // the identity of a legal record.
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = originalKey(tenantId, sha256);
  const path = join(root(), key);

  mkdirSync(dirname(path), { recursive: true });
  // Written under the content hash, so a repeat upload of identical bytes is
  // idempotent by construction rather than by a check that could race.
  writeFileSync(path, bytes, { flag: 'w' });

  return { key, sha256, byteSize: bytes.byteLength };
}

export function get(key: string): Buffer {
  // Resolved and then checked to be inside the root: a key containing `..`
  // would otherwise read any file the process can see.
  const path = resolve(join(root(), key));
  if (!path.startsWith(root())) throw new Error('Refusing to read outside the storage root.');
  return readFileSync(path);
}

/**
 * Writes bytes at an EXACT, caller-chosen key — unlike `put`, which derives
 * its own key from a content hash because an original is deduplicated by
 * content. Not everything this server stores wants that: the OCR shadow
 * stage's DocDOM JSON (`docs/contracts/phase1b-shadow-stage.md` §3) is keyed
 * by `<tenantId>/layouts/<captureId>/<runId>.json` — several runs over the
 * same capture are expected and each is its own record, not a re-upload of
 * the same bytes, so there is no hash to dedup against and the caller plans
 * the key instead.
 *
 * Same root-containment discipline as `get`, in the write direction: resolved
 * and checked to still be inside the storage root before anything touches
 * disk, so a key built from anything caller-influenced can never escape it.
 *
 * (`apps/server/src/captures/page-storage.ts`'s `putAtKey` is the same
 * primitive for a different lane's key scheme; unifying the two is a
 * follow-up noted there, not done here since that file is outside this
 * lane.)
 */
export function putAt(key: string, bytes: Buffer): void {
  const path = resolve(join(root(), key));
  if (!path.startsWith(root())) throw new Error('Refusing to write outside the storage root.');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: 'w' });
}
