import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { config } from '../config.js';

/**
 * The key one page's bytes live at, given its content hash.
 *
 * Must match `repo.ts`'s private `pageStorageKey` EXACTLY — that function
 * plans this key before any byte moves (to answer "already stored" for free),
 * and this module has to write to the key that was planned, not a key of its
 * own invention. Both sides derive it from nothing but the hash, so there is
 * no version to keep in sync at runtime, only this formula, documented in
 * `docs/contracts/phase0-multipage.md` §4.
 */
export function pageKey(tenantId: string, sha256Hex: string): string {
  return `${tenantId}/pages/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
}

/**
 * Writes one page's bytes at an EXACT, pre-planned storage key.
 *
 * `storage.ts` owns the single-file capture path and derives its own key from
 * the hash of what it is given (`originalKey`, under `<tenant>/originals/`).
 * A capture's pages are different: `repo.createCapture` PLANS a page's key
 * up front — `<tenant>/pages/<hash prefix>/<hash>` — so it can answer
 * "already stored" before any byte moves, which means the key is an INPUT
 * here rather than something this module derives itself.
 *
 * This mirrors `storage.ts`'s root-containment check (resolve, then require
 * the result stay under the storage root) instead of importing it, because
 * `storage.ts` is outside lane B for `docs/contracts/phase0-multipage.md` —
 * see the lane-B report for the follow-up to unify the two into one
 * "write at a key" primitive that both call.
 */
export function putAtKey(key: string, bytes: Buffer): void {
  const root = resolve(config().STORAGE_DIR);
  const path = resolve(join(root, key));
  if (!path.startsWith(root)) throw new Error('Refusing to write outside the storage root.');
  mkdirSync(dirname(path), { recursive: true });
  // Content-addressed key: an identical re-write of identical bytes is
  // idempotent by construction, so overwriting rather than checking first is
  // correct, not merely convenient.
  writeFileSync(path, bytes, { flag: 'w' });
}
