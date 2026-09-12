'use server';

import { revalidatePath } from 'next/cache';
import type { DocumentLine } from '@snap/api-contract';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * The review screen's writes.
 *
 * Bound with `(workspaceId, documentId, path)` from the page that renders the
 * form, so a client component can call these as plain `useActionState`
 * actions without ever handling a workspace id itself — the workspace a
 * correction applies to is decided by which page you are on, not by a value
 * a form could be made to send.
 *
 * `update` and `confirm` are deliberately separate functions, never combined
 * behind one "Save" button — `docs/PLAN.md` §5.1: editing a document changes
 * data, confirming it posts to the ledger, and only the second is the
 * draft → posted transition. Blurring them into one action is exactly the
 * mistake that section exists to prevent.
 */

/**
 * Field paths the server accepts on a correction — `documents.controller.ts`
 * `EDITABLE_PATHS`. Kept alongside the form fields that feed them so the two
 * never drift the way the contract and the old flat DTO did (see that
 * file's own comment on the bug this replaced: a correction sent in the
 * shape `@snap/api-contract` actually publishes was refused outright by a
 * whitelist validator expecting flat properties — found only by driving the
 * real app against the real server).
 */
const FIELD_PATHS: Record<string, string> = {
  supplierName: 'supplier.name',
  supplierAbn: 'supplier.abn',
  issueDate: 'header.issue_date',
  payableAmount: 'totals.payable',
  gstFreeAmount: 'totals.gst_free',
};

export async function updateDocument(
  workspaceId: string,
  documentId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const version = formData.get('version');
  const fields: Record<string, string | undefined> = {
    supplierName: str(formData, 'supplierName'),
    supplierAbn: str(formData, 'supplierAbn'),
    issueDate: str(formData, 'issueDate'),
    payableAmount: str(formData, 'payableAmount'),
    gstFreeAmount: str(formData, 'gstFreeAmount'),
  };
  // Only the field PATHS the form actually carried — an absent key must not
  // be read by the server as "clear this field". A field that IS present but
  // blank (the ABN or the GST-free amount, both optional) sends `null`,
  // which the server treats as "clear it" — never an empty string, which
  // `money.money('')` has no defined meaning for.
  const edits: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    edits[FIELD_PATHS[key]!] = value === '' ? null : value;
  }
  const body: Record<string, unknown> = {
    edits,
    version: version ? Number(version) : undefined,
  };
  if (body.version === undefined) delete body.version;

  try {
    await api(`/v1/documents/${documentId}`, {
      method: 'PATCH',
      body,
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function confirmDocument(
  workspaceId: string,
  documentId: string,
  path: string,
): Promise<ActionResult> {
  try {
    await api(`/v1/documents/${documentId}/confirm`, {
      method: 'POST',
      body: {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function rejectDocument(
  workspaceId: string,
  documentId: string,
  path: string,
  redirectTo: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason === '') return { ok: false, message: 'Say why — it helps the next scan of this supplier.' };
  try {
    await api(`/v1/documents/${documentId}/reject`, {
      method: 'POST',
      body: { reason },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath(path);
  revalidatePath(redirectTo);
  return { ok: true };
}

export async function updateLines(
  workspaceId: string,
  documentId: string,
  path: string,
  lines: DocumentLine[],
): Promise<ActionResult> {
  try {
    await api(`/v1/documents/${documentId}/lines`, {
      method: 'PUT',
      body: { lines },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function setVisibility(
  workspaceId: string,
  documentId: string,
  path: string,
  visibility: 'shared' | 'private',
): Promise<ActionResult> {
  try {
    await api(`/v1/documents/${documentId}/visibility`, {
      method: 'PATCH',
      body: { visibility },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath(path);
  return { ok: true };
}

function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' ? v : undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}
