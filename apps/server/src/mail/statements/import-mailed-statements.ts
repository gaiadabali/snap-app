import type { Db } from '@snap/db';
import { NotAMemberError } from '@snap/db';

import { createCaptureFromBytes, type CaptureFromBytesResult } from '../../captures/capture-from-bytes.js';
import { classifyExtractedText } from '../../extraction/classify.js';
import { extractPdfText } from '../../extraction/pdf.js';
import { MAX_STATEMENT_PAGES } from '../../statements/pdf-statement-import.js';
import { mailAvailable } from '../enabled.js';
import { ownedWorkspaceIds } from '../mail.repo.js';
import {
  claimImport,
  finishImport,
  importWorkspaceOf,
  markImportAcked,
  readImport,
  recordImportCapture,
  userForSub,
  type ImportRow,
  type ImportStatus,
} from './imports.repo.js';
import {
  actualKind,
  cleanFileName,
  declaredKind,
  detailText,
  isPasswordError,
  MAILED_STATEMENT_MAX_BYTES,
  parseStatementEvent,
  type OfferedFile,
  type StatementEvent,
} from './statement-event.js';
import { ackStatement, fetchOfferedFile, type FetchedFile } from './yourtal-statements.js';

/**
 * Statements that arrive by mail (Spambank T12; spambank/BUILD.md §4.8, F5):
 * the worker's half of a `spambank-statement` Security Event Token. The event
 * was verified and stored as a `yourtal_event` job (events.controller.ts) and
 * re-verified by the worker (events-job.ts) before this runs.
 *
 * YourTal only offers a message when the person switched statements on, the
 * mail is not in Spam, it passed DMARC, and its files are PDFs or CSVs of at
 * most 10 MB. For each offered file, in order:
 *
 *   1. its row in `mail_statement_imports` (0062) is claimed: a file already
 *      finished is not imported again, only told to YourTal if it was not yet;
 *   2. it needs a workspace: the one chosen in Mail settings, which the person
 *      must STILL own or administer (they may have been demoted since), else
 *      `skipped`;
 *   3. the bytes come from YourTal (`/attachments/fetch`, offered files only);
 *   4. a PDF is recognised by its own header, its text read: a password-
 *      protected PDF is `skipped: password_protected` (Stage 2 handles
 *      passwords), more than `MAX_STATEMENT_PAGES` (40) pages `skipped`, and a
 *      PDF the existing classifier does not call a statement `skipped:
 *      not_a_statement` — all before a capture exists or a credit is spent;
 *   5. `createCaptureFromBytes` makes the capture as the person: a CSV is read
 *      into a statement there and then (free); a PDF is charged one credit and
 *      queued for the existing statement reader (`classifyCapture` →
 *      `extractPdfText` → `importPdfStatement`); the same file already in that
 *      workspace is a `duplicate` (owner answer Q5: the same credits as an
 *      upload, and the 40-page limit);
 *   6. the outcome is stored, then sent to YourTal (`/statements/ack`).
 *
 * A failure worth retrying (YourTal or storage down) throws: the job runs again
 * with backoff, and the rows make the retry carry on where it stopped. Every
 * other outcome is recorded and acknowledged, never retried.
 *
 * Logs counts and outcome codes. Never the `sub`, the user id, a file name or
 * the bytes.
 */

type Log = Pick<Console, 'log' | 'warn' | 'error'>;

export type StatementEventOutcome =
  | { state: 'done'; counts: Record<Exclude<ImportStatus, 'pending'>, number> }
  | { state: 'dropped'; reason: 'bad_payload' | 'not_configured' | 'no_user' };

export type Outcome = { status: Exclude<ImportStatus, 'pending'>; detail: string; captureId?: string | null };

/** What the import calls out to; replaced in tests. */
export type StatementImportDeps = {
  fetch: (sub: string, emailId: string, blobId: string) => Promise<FetchedFile>;
  ack: typeof ackStatement;
  pdfText: (bytes: Buffer) => Promise<string[]>;
  ownedWorkspaces: (userId: string) => Promise<string[]>;
  capture: typeof createCaptureFromBytes;
};

export const defaultStatementImportDeps: StatementImportDeps = {
  fetch: (sub, emailId, blobId) => fetchOfferedFile(sub, emailId, blobId),
  ack: ackStatement,
  pdfText: extractPdfText,
  ownedWorkspaces: (userId) => ownedWorkspaceIds(userId),
  capture: createCaptureFromBytes,
};

/** YourTal down or the like: the job throws and runs again. */
export class RetryLater extends Error {}

export async function importMailedStatements(
  db: Db,
  event: { sub: string; body: Record<string, unknown> },
  log: Log = console,
  deps: StatementImportDeps = defaultStatementImportDeps,
): Promise<StatementEventOutcome> {
  const parsed = parseStatementEvent(event.body);
  if (!parsed) {
    log.warn('spambank-statement: the event is not the contract’s shape; dropped');
    return { state: 'dropped', reason: 'bad_payload' };
  }
  // Without the server client nothing can be fetched or acknowledged.
  if (!mailAvailable()) {
    log.log('spambank-statement: mail is not available here; dropped');
    return { state: 'dropped', reason: 'not_configured' };
  }

  const userId = await userForSub(db, event.sub);
  if (!userId) {
    // YourTal knows a SnapApp `sub` for them, SnapApp no longer has the account.
    for (const file of parsed.files) {
      if ((await deps.ack(event.sub, parsed.emailId, file.blobId, 'skipped', 'no_account')) === 'retry') {
        throw new RetryLater('spambank-statement: YourTal did not take the acknowledgement');
      }
    }
    log.log('spambank-statement: no SnapApp account for this person; acknowledged as skipped');
    return { state: 'dropped', reason: 'no_user' };
  }

  const tenantId = await importWorkspaceOf(db, userId);
  const counts = { imported: 0, duplicate: 0, skipped: 0, failed: 0 };
  for (const file of parsed.files) {
    const row = await claimImport(db, userId, {
      emailId: parsed.emailId,
      blobId: file.blobId,
      fileName: cleanFileName(file.name),
      receivedAt: parsed.receivedAt,
      tenantId,
    });

    let finished: ImportRow = row;
    if (row.status === 'pending') {
      const outcome = await importOne(db, userId, event.sub, parsed, file, row, deps);
      await finishImport(db, userId, row.id, outcome);
      finished = (await readImport(db, userId, row.id)) ?? row;
    }
    if (finished.status === 'pending') continue; // cannot happen: finishImport ran
    counts[finished.status] += 1;

    if (!finished.acked) {
      const acked = await deps.ack(event.sub, parsed.emailId, file.blobId, finished.status, finished.detail);
      if (acked === 'retry') throw new RetryLater('spambank-statement: YourTal did not take the acknowledgement');
      await markImportAcked(db, userId, row.id);
    }
  }

  log.log(
    `spambank-statement: ${counts.imported} imported, ${counts.duplicate} duplicate, ${counts.skipped} skipped, ${counts.failed} failed`,
  );
  return { state: 'done', counts };
}

/** One offered file, steps 2 to 5 of the header. Throws `RetryLater` (or a storage/database error) to retry. */
async function importOne(
  db: Db,
  userId: string,
  sub: string,
  event: StatementEvent,
  file: OfferedFile,
  row: ImportRow,
  deps: StatementImportDeps,
): Promise<Outcome> {
  const tenantId = row.tenantId;
  if (!tenantId) return { status: 'skipped', detail: 'no_workspace' };
  if (!(await deps.ownedWorkspaces(userId)).includes(tenantId.toLowerCase())) {
    return { status: 'skipped', detail: 'not_workspace_admin' };
  }

  const declared = declaredKind(file);
  if (!declared) return { status: 'skipped', detail: 'unsupported_type' };
  if (file.size > MAILED_STATEMENT_MAX_BYTES) return { status: 'skipped', detail: 'too_large' };

  const fetched = await deps.fetch(sub, event.emailId, file.blobId);
  switch (fetched.state) {
    case 'ok':
      break;
    case 'not_offered':
      return { status: 'failed', detail: 'not_offered' };
    case 'not_allowed':
      return { status: 'skipped', detail: 'not_allowed' };
    case 'rejected':
      return { status: 'failed', detail: detailText('yourtal_rejected', `status ${fetched.status}`) };
    case 'unavailable':
      throw new RetryLater(`spambank-statement: the file could not be fetched (status ${fetched.status ?? 'none'})`);
  }
  const bytes = fetched.bytes;
  if (bytes.byteLength === 0) return { status: 'failed', detail: 'empty' };
  if (bytes.byteLength > MAILED_STATEMENT_MAX_BYTES) return { status: 'skipped', detail: 'too_large' };

  const kind = actualKind(declared, bytes);
  if (!kind) return { status: 'failed', detail: 'not_a_pdf' };

  if (kind === 'pdf') {
    let pages: string[];
    try {
      pages = await deps.pdfText(bytes);
    } catch (error) {
      if (isPasswordError(error)) return { status: 'skipped', detail: 'password_protected' };
      return { status: 'failed', detail: 'unreadable_pdf' };
    }
    if (pages.length === 0) return { status: 'failed', detail: 'unreadable_pdf' };
    if (pages.length > MAX_STATEMENT_PAGES) {
      return { status: 'skipped', detail: detailText('too_many_pages', `${pages.length} pages; the limit is ${MAX_STATEMENT_PAGES}`) };
    }
    // The worker routes the capture by this same classifier; asking first means
    // a PDF that is not a statement is never charged for.
    if (classifyExtractedText(pages).kind !== 'statement') return { status: 'skipped', detail: 'not_a_statement' };
  }

  let made: CaptureFromBytesResult;
  try {
    made = await deps.capture(userId, tenantId, {
      kind,
      bytes,
      resumeCaptureId: row.captureId,
      onCreated: (captureId) => recordImportCapture(db, userId, row.id, captureId),
    });
  } catch (error) {
    // Left the workspace between the check above and the capture.
    if (error instanceof NotAMemberError) return { status: 'skipped', detail: 'not_workspace_admin' };
    throw error;
  }
  return outcomeOf(made);
}

/** A capture result as the row's status and detail. */
export function outcomeOf(made: CaptureFromBytesResult): Outcome {
  switch (made.outcome) {
    case 'statement':
      return {
        status: 'imported',
        detail: made.balanceCheck ? detailText('statement', `balance check ${made.balanceCheck}`) : 'statement',
        captureId: made.captureId,
      };
    case 'queued':
      return { status: 'imported', detail: 'queued', captureId: made.captureId };
    case 'held':
      return { status: 'imported', detail: 'waiting_for_credits', captureId: made.captureId };
    case 'duplicate':
      return { status: 'duplicate', detail: 'already_captured', captureId: made.captureId };
    case 'refused':
      if (made.reason === 'unreadable') {
        return { status: 'failed', detail: detailText('csv_unreadable', made.message), captureId: made.captureId };
      }
      return { status: 'skipped', detail: made.reason, captureId: made.captureId };
  }
}
