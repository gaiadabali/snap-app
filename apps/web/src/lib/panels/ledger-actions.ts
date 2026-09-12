'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * Moving a confirmed scan into the ledger.
 *
 * Two calls, matching `TransactionsController` exactly: proposing a draft
 * from a document's own lines and tax subtotals, and posting it — the one
 * act that actually moves the books, gated the same as confirming a document
 * (`Permissions.canConfirm`). Nothing here builds a split; the server derives
 * every one, on purpose (`docs/PLAN.md` §5).
 */
export async function draftTransactionFromDocument(
  workspaceId: string,
  documentId: string,
  path: string,
): Promise<ActionResult & { transactionId?: string }> {
  try {
    const outcome = await api<{ transactionId: string; status: 'draft' }>(
      `/v1/documents/${documentId}/transaction`,
      { method: 'POST', body: {}, workspaceId, idempotencyKey: newIdempotencyKey() },
    );
    revalidatePath(path);
    return { ok: true, transactionId: outcome.transactionId };
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not draft a transaction.' };
  }
}

/**
 * `(workspaceId, path, transactionId)` — path before the per-row id, matching
 * every other action in this codebase, so a page can bind `(workspace.id,
 * path)` once and hand the result straight to a list row as `onX(row.id)`.
 * `draftTransactionFromDocument` above still takes `documentId` before `path`
 * because it is called directly with a known document, never bound and
 * mapped over rows — the two shapes exist for two different call sites, not
 * by accident.
 */
export async function postTransaction(
  workspaceId: string,
  path: string,
  transactionId: string,
): Promise<ActionResult> {
  try {
    await api(`/v1/transactions/${transactionId}/post`, {
      method: 'POST',
      body: {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not post that transaction.' };
  }
  revalidatePath(path);
  return { ok: true };
}
