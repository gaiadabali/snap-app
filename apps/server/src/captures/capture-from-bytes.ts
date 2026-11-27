import { createHash } from 'node:crypto';

import type { StatementBalanceCheck } from '@snap/api-contract';

import { config } from '../config.js';
import { QuotaExhaustedError } from '../credits/spend.js';
import { demuxPdf, type DemuxedPage } from '../extraction/pdf.js';
import {
  captureDedupHash,
  countExtractionsToday,
  createCapture,
  enqueueExtraction,
  finalizeCapturePages,
  getDocumentIdForCapture,
  isCaptureQueued,
  markCaptureStored,
  recordCapturePage,
  resumeHeldCaptures,
} from '../repo.js';
import { importCsvStatement, type CsvImportResult } from '../statements/csv-import.js';
import { put as storagePut } from '../storage.js';
import { teenSpaceFunded } from '../teens/teens.repo.js';
import { pageKey, putAtKey } from './page-storage.js';

/**
 * A capture made from bytes the server already holds, rather than from a
 * phone's two-step register-then-upload (Spambank T12: a statement mailed to
 * the person's Spambank address, spambank/BUILD.md §4.8).
 *
 * The two `store*Capture` functions are the CSV and PDF branches of
 * `PUT /v1/uploads/:token` (`captures.controller.ts`), moved here unchanged so
 * the upload and the mail path run the same steps: the original written
 * content-addressed and pointed at, then, for a CSV, read into a statement
 * (`importCsvStatement`) and, for a PDF, rendered into its pages, recorded,
 * and its page count and dedup hash finalised.
 *
 * `createCaptureFromBytes` composes them with the intake rules of
 * `POST /v1/captures` and the queueing of the upload, with one difference the
 * owner decided (Q5, 2026-11-27): a mailed PDF statement may have up to
 * `MAX_STATEMENT_PAGES` pages (40; the caller checks) and costs ONE credit,
 * where an uploaded PDF is one page per snap (ruling 0.11.b). Everything else
 * is the upload's rule: a CSV is free and read at once; a PDF needs a credit
 * at registration, is refused when the workspace's daily extraction budget is
 * spent, is queued for the existing worker path (`classifyCapture` →
 * `extractPdfText` → `importPdfStatement`), and waits, stored, if its credit
 * was spent elsewhere in between. The same bytes already captured in that
 * workspace come back as a duplicate, never a second capture.
 *
 * Runs as the PERSON (`withTenantAs(user, tenant)` in every repo call), so the
 * membership check, RLS and the credit spend are theirs, exactly as for an
 * upload. Who may put a file in which workspace is the caller's decision.
 */

/** The CSV branch of an upload: the original stored and pointed at, then read into a statement. */
export async function storeCsvCapture(
  userId: string,
  tenantId: string,
  captureId: string,
  bytes: Buffer,
  financialAccountId?: string,
): Promise<{ sha256: string; result: CsvImportResult }> {
  // No page image, no `capture_pages` row, no queued extraction — §5.6 is
  // explicit that mode (c) needs none of that ("Extraction needed: None").
  // The original bytes still go through the same L0 "originals" store a PDF's
  // do, for the same reason: the file is the legal record, and
  // `documents.capture_id` needs a `captures` row whose `original_storage_key`
  // actually resolves.
  const original = storagePut(tenantId, bytes);
  await markCaptureStored(userId, tenantId, captureId, original.key);
  const result = await importCsvStatement(userId, tenantId, { captureId, bytes, financialAccountId });
  return { sha256: original.sha256, result };
}

export type StorePdfResult =
  | { ok: true; sha256: string; pages: number }
  | { ok: false; sha256: string; duplicateCaptureId: string };

/**
 * The PDF branch of an upload: the original written to the L0 "originals"
 * store before anything else touches it (`captures.controller.ts` explains
 * why at length), its pages rendered (or `rendered`, when the caller already
 * did) and recorded, then the capture's page count and dedup hash corrected to
 * the demuxed set. Idempotent: a repeat writes the same keys and values.
 */
export async function storePdfCapture(
  userId: string,
  tenantId: string,
  captureId: string,
  bytes: Buffer,
  rendered?: DemuxedPage[],
): Promise<StorePdfResult> {
  const original = storagePut(tenantId, bytes);
  await markCaptureStored(userId, tenantId, captureId, original.key);

  const pages = rendered ?? (await demuxPdf(bytes));
  // In page order, for the capture-level dedup hash below.
  const pageHashes: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const sha256 = createHash('sha256').update(page.bytes).digest('hex');
    pageHashes.push(sha256);
    const storageKey = pageKey(tenantId, sha256);
    putAtKey(storageKey, page.bytes);
    await recordCapturePage(userId, tenantId, {
      captureId,
      pageNumber: i + 1,
      storageKey,
      mimeType: page.mimeType,
      byteSize: page.bytes.byteLength,
      sha256,
      width: page.width,
      height: page.height,
      source: page.source,
    });
  }

  // `original_sha256` is what `captures_sha_unique` enforces, so it is
  // recomputed from the demuxed pages; the PDF itself stays the L0 original.
  const finalized = await finalizeCapturePages(
    userId,
    tenantId,
    captureId,
    pageHashes.map((sha256) => ({ sha256 })),
  );
  if (!finalized.ok) return { ok: false, sha256: original.sha256, duplicateCaptureId: finalized.duplicateCaptureId };
  return { ok: true, sha256: original.sha256, pages: pages.length };
}

export type CaptureFromBytesInput = {
  kind: 'csv' | 'pdf';
  bytes: Buffer;
  /**
   * The capture an earlier, interrupted attempt of this same import created.
   * Met again at registration it is this import's own, carried on, not
   * reported as a duplicate of itself.
   */
  resumeCaptureId?: string | null;
  /** Called with a NEW capture's id before any bytes are stored, so the caller can remember it (see above). */
  onCreated?: (captureId: string) => Promise<void>;
};

export type CaptureFromBytesResult =
  /** A CSV read into a statement. `balanceCheck`/`lineCount` are null when an earlier attempt already read it. */
  | {
      outcome: 'statement';
      captureId: string;
      documentId: string | null;
      balanceCheck: StatementBalanceCheck | null;
      lineCount: number | null;
    }
  /** A PDF stored, charged one credit, and queued for the statement reader. */
  | { outcome: 'queued'; captureId: string; pages: number }
  /** A PDF stored but not charged: its credit went elsewhere in between. Read once credits are bought (7.1.b). */
  | { outcome: 'held'; captureId: string; pages: number }
  /** These bytes are already a capture in this workspace. */
  | { outcome: 'duplicate'; captureId: string }
  | {
      outcome: 'refused';
      reason: 'no_credits' | 'daily_limit' | 'teen_space_unfunded' | 'unreadable';
      message: string;
      /** Set when a capture was made before the refusal (a CSV the importer could not read). */
      captureId: string | null;
    };

/**
 * Makes a capture from a whole file, owned by `userId` in `tenantId`. See the
 * module header for the rules. Throws only for a failure worth retrying
 * (storage, the database); every business outcome is a result.
 */
export async function createCaptureFromBytes(
  userId: string,
  tenantId: string,
  input: CaptureFromBytesInput,
): Promise<CaptureFromBytesResult> {
  const { kind, bytes } = input;

  // A teen's space whose parent no longer owns the paying workspace (0045 TS004).
  if ((await teenSpaceFunded(userId, tenantId)) === false) {
    return {
      outcome: 'refused',
      reason: 'teen_space_unfunded',
      message: 'Scans in this space use a parent’s credits, and their workspace can’t pay for them any more.',
      captureId: null,
    };
  }

  // A PDF's identity is its demuxed pages (`finalizeCapturePages`), so it is
  // rendered first: the dedup hash registered is then the one an uploaded copy
  // of the same file ends up with, and a duplicate is found before anything
  // is stored or charged. A CSV's identity is the file's own hash, as on upload.
  const rendered = kind === 'pdf' ? await demuxPdf(bytes) : null;
  const dedupHash = rendered
    ? captureDedupHash(rendered.map((p) => ({ sha256: createHash('sha256').update(p.bytes).digest('hex') })))
    : createHash('sha256').update(bytes).digest('hex');

  // Before registering, so a refusal leaves no capture behind. (An upload
  // registers first and refuses at the PUT; here there is no second request.)
  if (
    kind === 'pdf' &&
    !input.resumeCaptureId &&
    (await countExtractionsToday(userId, tenantId)) >= config().EXTRACTION_DAILY_BUDGET
  ) {
    return {
      outcome: 'refused',
      reason: 'daily_limit',
      message: 'This workspace has used all its extractions for today.',
      captureId: null,
    };
  }

  let registered: Awaited<ReturnType<typeof createCapture>>;
  try {
    registered = await createCapture(userId, tenantId, {
      pages: [{ sha256: dedupHash, mimeType: kind === 'pdf' ? 'application/pdf' : 'text/csv', byteSize: bytes.byteLength }],
      requireCredit: kind === 'pdf',
    });
  } catch (error) {
    if (error instanceof QuotaExhaustedError) {
      return { outcome: 'refused', reason: 'no_credits', message: 'Out of scan credits.', captureId: null };
    }
    throw error;
  }
  const captureId = registered.capture.id;
  const ours = !registered.duplicate || (input.resumeCaptureId != null && captureId === input.resumeCaptureId.toLowerCase());
  if (!ours) return { outcome: 'duplicate', captureId };

  if (!registered.duplicate) {
    await input.onCreated?.(captureId);
    // There is a credit now (the registration's check passed): snaps held for
    // want of one are read first, as after any new snap (7.1.b). This one has
    // no pages yet, so it is never among them.
    // (`resumeAfterCredits`'s body, without importing a controller into the worker.)
    if (kind === 'pdf') {
      try {
        await resumeHeldCaptures(userId, tenantId, config().EXTRACTION_DAILY_BUDGET);
      } catch (error) {
        console.error(`could not queue held captures for tenant ${tenantId}: ${String(error)}`);
      }
    }
  }

  if (kind === 'csv') {
    // An earlier attempt may have read it already; reading twice would make two statements.
    const existing = await getDocumentIdForCapture(userId, tenantId, captureId);
    if (existing.captureExists && existing.documentId) {
      return { outcome: 'statement', captureId, documentId: existing.documentId, balanceCheck: null, lineCount: null };
    }
    const { result } = await storeCsvCapture(userId, tenantId, captureId, bytes);
    if (!result.ok) return { outcome: 'refused', reason: 'unreadable', message: result.reason, captureId };
    return {
      outcome: 'statement',
      captureId,
      documentId: result.documentId,
      balanceCheck: result.balanceCheck,
      lineCount: result.lineCount,
    };
  }

  const stored = await storePdfCapture(userId, tenantId, captureId, bytes, rendered!);
  // Cannot happen with the hash registered above; reported honestly if it does.
  if (!stored.ok) return { outcome: 'duplicate', captureId: stored.duplicateCaptureId };

  if (await isCaptureQueued(userId, tenantId, captureId)) return { outcome: 'queued', captureId, pages: stored.pages };
  try {
    await enqueueExtraction(userId, tenantId, captureId);
  } catch (error) {
    if (error instanceof QuotaExhaustedError) return { outcome: 'held', captureId, pages: stored.pages };
    throw error;
  }
  return { outcome: 'queued', captureId, pages: stored.pages };
}
