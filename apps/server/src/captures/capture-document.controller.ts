import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DocumentView, PatchCaptureDocumentRequest } from '@snap/api-contract';
import { money } from '@snap/db';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { consumptionTaxFromRules, toWire } from '../documents/documents.controller.js';
import { expectedGst } from '../extraction/validators.js';
import {
  getDocument,
  getDocumentIdForCapture,
  listCapturePages,
  readTenant,
  updateDocument,
} from '../repo.js';
import { rulesFor } from '../taxrules/taxrules.repo.js';

/**
 * A correction made before the server's own document exists yet.
 *
 * `docs/ON-DEVICE.md` §7.2 (OD-11). Stage 2 lets a person edit the on-device
 * preview — the platform recogniser's own reading — before extraction has
 * run, and that edit is queued in the mobile outbox so it survives the phone
 * losing signal. This is the endpoint the outbox eventually replays it
 * against, and it is addressed by CAPTURE rather than by document for exactly
 * that reason: at the moment the edit was MADE, there was no document id to
 * address it to.
 *
 * THE HAZARD THIS FILE EXISTS TO HANDLE is stated in the ticket, not invented
 * here: a correction can be replayed against a capture whose extraction has
 * not run, has run, or has run TWICE (a later re-extraction, possibly after
 * the correction already landed) — and it can be replayed more than once by
 * the outbox's own retry. Each of those is a normal state, not a bug, and a
 * first implementation that treats any of them as "just apply it" either
 * throws away the edit or lets a later machine run silently overwrite it:
 *
 *   - NOT RUN YET: there is no `documents` row to edit. This answers
 *     `409 document_not_ready` with `error: 'document_not_ready'` in the
 *     body — a code the mobile outbox reads (`apps/mobile/src/api/http.ts`)
 *     to tell "try again later" apart from a permanent 4xx it should drop.
 *     Answering 404 here would be wrong: the capture is real, the request is
 *     well-formed, and the client should retry the SAME request rather than
 *     give up or ask a human — which is what 409 means and 404 does not.
 *   - RUN ONCE: `updateDocument` applies the edit and — this is the load-
 *     bearing line — unions the touched paths into `documents.locked_fields`
 *     unconditionally, not only when the caller asks to "confirm". A person
 *     correcting a field before the record exists has settled it exactly as
 *     much as one correcting it after.
 *   - RUN TWICE: a re-extraction (`saveExtraction`) that disagrees with a
 *     locked path never overwrites it — it raises a
 *     `reextraction_disagrees_with_human` review task and keeps the human's
 *     value. That guarantee already exists (migration 0009, `saveExtraction`
 *     in `repo.ts`) and needs nothing new here; the point of THIS endpoint is
 *     only to make sure the lock gets written in the first place, no matter
 *     which order "extraction finishes" and "correction arrives" happen in.
 *   - REPLAYED BY THE OUTBOX: the global `IdempotencyInterceptor`
 *     (`apps/server/src/common/idempotency.interceptor.ts`) sits in front of
 *     every write and is keyed on the SAME `Idempotency-Key` the outbox never
 *     regenerates. A 409 here releases that claim (the interceptor's error
 *     branch), so the identical retry actually re-runs this handler instead
 *     of replaying a cached failure forever; a 200 records the outcome, so a
 *     retry AFTER success replays the same response rather than applying the
 *     edit a second time. Belt and suspenders: even without that cache, this
 *     handler is idempotent by construction — replaying the same `edits`
 *     re-sets the same column values and re-unions the same path into an
 *     already-locked set, which is a no-op, not a second edit.
 *
 * A separate controller from `DocumentsController`, not a second method on
 * it, for the same reason `DeviceReadingController` is separate: the address
 * space is different (capture, not document) and the failure mode this file
 * exists to produce — 409, not 404 — only makes sense from a capture's side.
 */

/** Mirrors `documents.controller.ts`'s `EDITABLE_PATHS`. Kept as a separate
 *  small copy rather than an import because that map is private to a file
 *  this ticket's ownership boundary does not extend to; the two are not
 *  expected to drift because both express the same five columns that a
 *  document, wherever it is addressed from, can be corrected on. */
const EDITABLE_PATHS = {
  'supplier.name': 'supplierName',
  'supplier.abn': 'supplierAbn',
  'header.issue_date': 'issueDate',
  'totals.payable': 'payableAmount',
  'totals.gst_free': 'gstFreeAmount',
} as const;

/** See `documents.controller.ts`'s `flattenEdits` — same paths, same refusal
 *  for an unknown one, because an edit that is accepted and silently dropped
 *  is worse than one the client can see was rejected. */
function flattenEdits(edits: Record<string, string | number | null>): {
  supplierName?: string;
  supplierAbn?: string | null;
  issueDate?: string;
  payableAmount?: string;
  gstFreeAmount?: string | null;
} {
  const patch: Record<string, string | null> = {};
  for (const [path, value] of Object.entries(edits ?? {})) {
    if (path === 'header.category') {
      throw new BadRequestException(
        'Category cannot be saved yet: it is not stored on the server. Correct the other fields and leave the category alone.',
      );
    }
    const column = (EDITABLE_PATHS as Record<string, string | undefined>)[path];
    if (!column) {
      throw new BadRequestException(
        `Cannot correct '${path}'. Editable fields are: ${Object.keys(EDITABLE_PATHS).join(', ')}.`,
      );
    }
    patch[column] = value == null ? null : String(value);
  }
  return patch;
}

export class PatchCaptureDocumentDto implements PatchCaptureDocumentRequest {
  edits!: Record<string, string | number | null>;
  previewEngine?: 'device-vision' | 'device-mlkit';
  version?: number;
}

@ApiTags('captures')
@Controller('v1/captures/:captureId/document')
@UseGuards(SessionGuard, MembershipGuard)
export class CaptureDocumentController {
  @Patch()
  @ApiOperation({
    summary: 'Correct a document before or after extraction has produced one',
    description:
      '409 document_not_ready until extraction has produced a document for this capture. The mobile outbox is expected to retry with the same Idempotency-Key; the correction is deferred, not rejected.',
  })
  async patch(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('captureId') captureId: string,
    @Body() body: PatchCaptureDocumentDto,
  ): Promise<DocumentView> {
    if (!body || typeof body.edits !== 'object' || body.edits === null || Array.isArray(body.edits)) {
      throw new BadRequestException('Send edits as an object of field path to value.');
    }

    const found = await getDocumentIdForCapture(user.userId, tenantId, captureId);
    if (!found.captureExists) {
      throw new NotFoundException('No such capture.');
    }
    if (!found.documentId) {
      // THE POINT OF THE TICKET. Not a 404 — the capture is real and the
      // request is well-formed, it is simply early. 409 is the status the
      // mobile outbox's http layer recognises (paired with this exact
      // `error` code) as "retry me", as distinct from a permanent 4xx it
      // would otherwise drop the write for after one attempt.
      throw new HttpException(
        {
          error: 'document_not_ready',
          message:
            "Waiting for the server's read before this correction can apply. It will be retried automatically.",
        },
        HttpStatus.CONFLICT,
      );
    }

    const documentId = found.documentId;
    const before = await getDocument(user.userId, tenantId, documentId);
    if (!before) {
      // Deleted between the lookup above and here — vanishingly unlikely in
      // one request, but the two reads are not one transaction, so it is a
      // real state rather than one the type system can rule out.
      throw new NotFoundException('No such document.');
    }

    const edit = flattenEdits(body.edits);

    // Correcting the total re-derives the tax exactly as `PATCH
    // /v1/documents/:id` does: tax is a function of the taxable part, never
    // taken from the client, because accepting both invites them to disagree.
    // Resolved unconditionally (not just when the total is edited): the reply
    // below re-serialises the document via `toWire`, which needs the same
    // rule set to restate the per-category tax subtotals.
    const tenant = await readTenant(user.userId, tenantId);
    const taxRules = tenant?.tax_rules_id ? await rulesFor(tenant) : null;

    let taxAmount: string | undefined;
    let taxExclusiveAmount: string | undefined;
    const payable = edit.payableAmount ?? before.document.payable_amount;
    if (edit.payableAmount != null || edit.gstFreeAmount !== undefined) {
      taxAmount = expectedGst(payable ?? '0', edit.gstFreeAmount ?? '0', taxRules);
      taxExclusiveAmount = money.subtract(money.money(payable ?? '0'), money.money(taxAmount));
    }

    const abn =
      edit.supplierAbn === undefined
        ? before.document.supplier_abn
        : (edit.supplierAbn?.replace(/\D/g, '') || null);

    const outcome = await updateDocument(
      user.userId,
      tenantId,
      documentId,
      {
        supplierName: edit.supplierName,
        supplierAbn: edit.supplierAbn === undefined ? undefined : abn,
        issueDate: edit.issueDate,
        payableAmount: edit.payableAmount,
        taxAmount,
        taxExclusiveAmount,
      },
      body.version,
    );

    if (!outcome.ok) {
      if (outcome.reason === 'missing') throw new NotFoundException('No such document.');
      // A genuine optimistic-concurrency conflict — NOT the retryable 409
      // above. Thrown as a plain string body (no `error` code) precisely so
      // the outbox does NOT mistake it for `document_not_ready` and retry it
      // blindly: a version conflict needs a fresh read, not a resend.
      throw new ConflictException(
        'Someone else changed this document while you were offline. Reload and try again.',
      );
    }

    const after = await getDocument(user.userId, tenantId, documentId);
    const pages = await listCapturePages(user.userId, tenantId, captureId);
    return toWire(after!.document, after!.lines, pages, consumptionTaxFromRules(taxRules));
  }
}
