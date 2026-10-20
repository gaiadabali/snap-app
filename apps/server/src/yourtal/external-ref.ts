import { createHash } from 'node:crypto';

import { get as readObject } from '../storage.js';

/**
 * The `externalRef` a receipt is reported to YourTal under.
 *
 * YourTal pays a receipt ONCE per partner, keyed on this value
 * (partner-api.md §2), so it has to name the physical receipt and stay the
 * same however many times the receipt is processed. It is a content hash of
 * the ORIGINAL as stored — the bytes the user's device sent, kept unmodified
 * as the legal record — and never a hash of anything this server derived:
 *
 *   - Not `captures.original_sha256`. That column starts as the hash the
 *     CLIENT declared, which "decides whether to bother uploading" but never
 *     the identity of a record (captures.controller.ts), and for a PDF it is
 *     rewritten after demux to a hash over RASTERISED page renders.
 *   - Not the normalised derivative or a page render, whose bytes change with
 *     the renderer.
 *
 * What it is, by kind of capture:
 *
 *   - Photographed pages (`capture_pages.source = 'capture'`). Each page's
 *     `sha256` was computed by the upload handler over the bytes it received
 *     and stored unmodified under that hash. One page: that hash — exactly the
 *     SHA-256 of the stored file. Several pages: SHA-256 of the page hashes
 *     concatenated as lowercase hex text in page order, the same rule as
 *     `captureDedupHash` in repo.ts, because a multi-photo receipt is one
 *     receipt.
 *   - A PDF, or any capture without a full set of photographed pages: the
 *     SHA-256 of the file at `original_storage_key`, read back from storage.
 *
 * Written as `sha256:<64 lowercase hex>`.
 */

export interface ReceiptOriginal {
  mimeType: string;
  storageKey: string;
  pageCount: number;
  /** `capture_pages.sha256` (hex) of the photographed pages, in page order. */
  capturePageHashes: string[];
  /** `captures.received_at`, ISO. */
  receivedAt: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function receiptExternalRef(
  original: ReceiptOriginal,
  read: (key: string) => Buffer = readObject,
): string {
  const pages = original.capturePageHashes.map((h) => h.toLowerCase());
  const photographed =
    original.mimeType.toLowerCase() !== 'application/pdf' &&
    pages.length > 0 &&
    pages.length === original.pageCount &&
    pages.every((h) => HEX64.test(h));

  if (photographed) {
    const hex =
      pages.length === 1 ? pages[0]! : createHash('sha256').update(pages.join(''), 'utf8').digest('hex');
    return `sha256:${hex}`;
  }

  // Throws when the original cannot be read; the caller logs and queues
  // nothing rather than inventing a reference.
  const bytes = read(original.storageKey);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
