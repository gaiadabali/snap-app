import { createHash, createHmac } from 'node:crypto';

import { get as readObject } from '../storage.js';

/**
 * The `externalRef` a receipt is reported to YourTal under.
 *
 * YourTal pays a receipt ONCE per partner, keyed on this value
 * (partner-api.md §2), so it has to name the physical receipt and stay the
 * same however many times the receipt is processed. There are two kinds, and
 * `queueReceiptReport` picks one per capture:
 *
 *   1. A CONTENT ref, `rcpt:v1:<64 hex>` (`receiptContentRef`), when the
 *      receipt has a document number. It names what the receipt SAYS, so a
 *      second photo of the same paper receipt gets the same ref, whoever
 *      takes it and in whichever workspace. YourTal then pays it once, and
 *      answers `duplicate: true` to anyone else who reports it.
 *   2. An IMAGE ref, `sha256:<64 hex>` (`receiptExternalRef`), for everything
 *      else: a hash of the stored original. A second photo is different bytes
 *      and so a different ref; the in-workspace likely-duplicate check in
 *      `queueReceiptReport` is the only protection against it.
 *
 * The image ref is a content hash of the ORIGINAL as stored — the bytes the
 * user's device sent, kept unmodified as the legal record — and never a hash
 * of anything this server derived:
 *
 *   - Not `captures.original_sha256`. That column starts as the hash the
 *     CLIENT declared, which "decides whether to bother uploading" but never
 *     the identity of a record (captures.controller.ts), and for a PDF it is
 *     rewritten after demux to a hash over RASTERISED page renders.
 *   - Not the normalised derivative or a page render, whose bytes change with
 *     the renderer.
 *
 * What the image ref is, by kind of capture:
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

// ── The content ref ──────────────────────────────────────────────────────────

/**
 * What a receipt says, as STORED on its document and supplier party (so a
 * field a person corrected and locked counts, not what the model first read).
 */
export interface ReceiptContent {
  /** The supplier's ABN, only when it is a VALID 11-digit ABN (`parties.abn_valid`). */
  supplierAbn: string | null;
  /** `parties.name_normalised`. */
  supplierName: string | null;
  /** `documents.issue_date`, YYYY-MM-DD. */
  issueDate: string | null;
  /** `documents.payable_amount`, numeric text as stored. */
  payableAmount: string | null;
  currency: string | null;
  documentNumber: string | null;
}

const LOOK_ALIKE: Record<string, string> = { O: '0', I: '1', L: '1' };

/**
 * The invoice or receipt number in a form that survives re-reading: NFKC,
 * uppercase, and the value must contain an ASCII digit (so "INVOICE" cannot
 * turn into "1NV01CE" and pass for a number). Then only [A-Z0-9] is kept, the
 * OCR look-alikes O, I and L become 0, 1 and 1, and the leading zeros of each
 * run of digits are dropped. "INV-00123", "inv 123" and "INV0O123" all become
 * "1NV123". Null when nothing usable is left.
 */
function normaliseDocumentNumber(raw: string | null): string | null {
  if (raw == null) return null;
  const upper = raw.normalize('NFKC').toUpperCase();
  if (!/[0-9]/.test(upper)) return null;
  const kept = upper
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[OIL]/g, (c) => LOOK_ALIKE[c]!)
    .replace(/[0-9]+/g, (run) => run.replace(/^0+/, ''));
  return kept === '' ? null : kept;
}

/**
 * The amount as canonical decimal text, exact (no floating point): "12.50",
 * "12.5" and "12.500" are "12.5", "12.00" is "12", and a refund keeps its '-'.
 * Null for anything that is not a plain decimal number.
 */
function canonicalAmount(raw: string | null): string | null {
  if (raw == null) return null;
  const m = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(raw.trim());
  if (!m) return null;
  const whole = m[2]!.replace(/^0+(?=\d)/, '');
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  const magnitude = fraction ? `${whole}.${fraction}` : whole;
  return m[1] === '-' && magnitude !== '0' ? `-${magnitude}` : magnitude;
}

/**
 * The `externalRef` for a receipt that has a document number: a keyed hash of
 * what it says, `rcpt:v1:<64 lowercase hex>`. Two photos of one paper receipt
 * give the same ref, so YourTal pays it once however many times, in however
 * many workspaces, by however many people it is scanned.
 *
 * Null (no content ref; the caller falls back to the image ref and the
 * in-workspace likely-duplicate check) unless ALL of these hold: a usable
 * document number, an issue date, a payable amount, a currency, and a supplier
 * (a valid ABN, else a non-empty normalised name). The document number is the
 * point. Without it the key (supplier, date, total) is weak, and two strangers
 * buying the same coffee at the same café on the same day would collide, and
 * the second would earn nothing. A missed duplicate costs one point (A$0.03);
 * a false collision cheats a real person.
 *
 * HMAC, not a plain hash: the inputs are low-entropy (a known shop, a date, a
 * small total), so a plain hash would let anyone holding the ref, YourTal or a
 * leaked table, confirm a guess of where, when and for how much a person
 * shopped. The key is Snap Apps' own (`YOURTAL_RECEIPT_REF_KEY`) and is never
 * shared with YourTal. It must never be rotated: a new key gives every old
 * receipt a new ref, and they could all be paid again.
 *
 * The message is these lines joined with "\n": `snap-receipt-ref/v1`, the
 * supplier (`abn:<digits>` or `name:<normalised name>`), the date, the
 * currency, the amount and the normalised document number.
 */
export function receiptContentRef(fields: ReceiptContent, key: string | Buffer): string | null {
  const documentNumber = normaliseDocumentNumber(fields.documentNumber);
  if (!documentNumber) return null;

  const issueDate = fields.issueDate?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return null;

  const amount = canonicalAmount(fields.payableAmount);
  if (amount == null) return null;

  const currency = fields.currency?.trim().toUpperCase() ?? '';
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  const abn = fields.supplierAbn?.trim() ?? '';
  const name = (fields.supplierName ?? '').replace(/[\r\n]+/g, ' ').trim();
  const supplier = /^\d{11}$/.test(abn) ? `abn:${abn}` : name ? `name:${name}` : null;
  if (!supplier) return null;

  const message = ['snap-receipt-ref/v1', supplier, issueDate, currency, amount, documentNumber].join('\n');
  return `rcpt:v1:${createHmac('sha256', key).update(message, 'utf8').digest('hex')}`;
}
