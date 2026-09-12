import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Header,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DocumentView, ExtractionFinding, PageSource } from '@snap/api-contract';
import { money } from '@snap/db';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { linesGap } from '../extraction/validators.js';
import {
  getDocument,
  listCapturePages,
  listDocuments,
  listMembers,
  replaceLines,
  updateDocument,
  type CapturePageRow,
  type DocumentRow,
  type LineRow,
} from '../repo.js';
import { abnIsValid, validate } from '../extraction/validators.js';
import { getCaptureForDocument } from '../repo.js';
import { get as readObject } from '../storage.js';
import { issueImageToken } from '../tokens.js';

/* ── DTOs ────────────────────────────────────────────────────────────────── */

export class VisibilityDto {
  @IsIn(['shared', 'private']) visibility!: 'shared' | 'private';
}

/**
 * `PATCH /v1/documents/:id`, in the shape the contract actually publishes.
 *
 * This took a flat `{supplierName, issueDate, ...}` body while
 * `UpdateDocumentRequest` in `@snap/api-contract` has said
 * `{edits: {<field path>: value}}` all along — so every correction the mobile
 * app sent was rejected wholesale by the validation whitelist with
 * "property edits should not exist". Correcting a field, the single most
 * important interaction in the product, could not be done by any client
 * following the published contract.
 *
 * It survived because nothing typed this class against the contract: the app
 * compiled, the server compiled, and the two disagreed only at runtime. Found
 * by driving the real app against the real server, which is the only thing
 * that could have found it.
 *
 * Field PATHS rather than property names, because that is the vocabulary the
 * rest of the system already speaks: `documents.locked_fields` records them,
 * `document_field_corrections` records them, and grounding reports them.
 */
export class UpdateDocumentDto {
  @IsObject({ message: 'Send edits as an object of field path to value.' })
  edits!: Record<string, string | number | null>;

  /** Confirming locks the edited fields against a later machine run. */
  @IsOptional() @IsBoolean() confirm?: boolean;

  /**
   * The version the client last read.
   *
   * Optional but strongly encouraged: without it, two people correcting the
   * same extraction silently overwrite each other, and these are money fields.
   */
  @IsOptional() @IsInt() @Min(1) version?: number;
}

/** The paths a correction may carry, and which column each one settles. */
const EDITABLE_PATHS = {
  'supplier.name': 'supplierName',
  'supplier.abn': 'supplierAbn',
  'header.issue_date': 'issueDate',
  'totals.payable': 'payableAmount',
  'totals.gst_free': 'gstFreeAmount',
} as const;

/**
 * Translate the contract's paths into the flat patch this handler works in.
 *
 * Unknown paths are REFUSED rather than ignored. A correction that is accepted
 * and quietly dropped is the worst outcome available: the user sees their
 * change, saves, and finds the old value again later with nothing to explain
 * it — wrong, and claiming to be right.
 */
function flattenEdits(edits: Record<string, string | number | null>): {
  supplierName?: string;
  supplierAbn?: string | null;
  issueDate?: string;
  payableAmount?: string;
  gstFreeAmount?: string | null;
} {
  const patch: Record<string, string | null> = {};
  for (const [path, value] of Object.entries(edits)) {
    if (path === 'header.category') {
      // The app offers category chips; the server has nowhere to put one —
      // `documents` has no category column, and `toWire` returns a constant.
      // Refused explicitly rather than swallowed, so the gap is visible
      // instead of looking like data loss.
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

export class LineDto {
  @IsString() description!: string;
  @IsNumber() @Min(0) quantity!: number;
  @Matches(/^-?\d+(\.\d{1,4})?$/) unitPrice!: string;
  @Matches(/^-?\d+(\.\d{1,4})?$/) amount!: string;
  @IsBoolean() gstFree!: boolean;
}

export class ReplaceLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
}

export class RejectDto {
  @IsOptional() @IsString() reason?: string;
}

/* ── Serialisation ───────────────────────────────────────────────────────── */

/**
 * The wire shape, matching the mobile app's `DocumentView`.
 *
 * Translated in one place. The app has been built against these names for
 * weeks; renaming fourteen screens to match whatever the database calls a
 * column would be work with no benefit to anyone.
 */
export function toWire(document: DocumentRow, lines: LineRow[], pages: CapturePageRow[]): DocumentView {
  const compliance = document.ato_compliance ?? {};
  const failures = compliance.failures ?? [];
  const findings: ExtractionFinding[] = compliance.findings ?? [];
  const payable = document.payable_amount ?? '0';
  const gstFree = lines
    .filter((l) => l.gst_category_code === 'Z')
    .reduce((acc, l) => acc + Number(l.line_net_amount ?? 0), 0);

  const wireLines = lines.map((l) => ({
    lineNumber: l.line_number,
    description: l.description ?? 'Item',
    quantity: Number(l.quantity ?? 1),
    unitPrice: l.unit_price ?? '0.0000',
    amount: l.line_net_amount ?? '0.0000',
    gstFree: l.gst_category_code === 'Z',
    category: null,
    confidence: Number(l.line_confidence ?? 1),
  }));

  const lineSum = wireLines.reduce((acc, l) => acc + Number(l.amount), 0);

  return {
    id: document.id,
    supplierName: document.supplier_name ?? 'Unknown supplier',
    supplierAbn: document.supplier_abn,
    supplierAbnValid: document.supplier_abn_valid === true,
    issueDate: document.issue_date ?? '',
    currency: document.currency,
    taxExclusiveAmount: document.tax_exclusive_amount ?? '0.0000',
    taxAmount: document.tax_amount ?? '0.0000',
    payableAmount: payable,
    gstFreeAmount: gstFree > 0 ? gstFree.toFixed(4) : null,
    isTaxInvoice: document.is_tax_invoice,
    docType: document.is_tax_invoice ? ('tax_invoice' as const) : ('receipt' as const),
    // Categorisation is a later phase; until then the deduction row is unset
    // rather than guessed, because a wrong category is a wrong deduction.
    category: 'Uncategorised',
    engineRowId: 'unassigned',
    reviewStatus: document.review_status as 'auto_accepted' | 'needs_review' | 'reviewed' | 'rejected',
    confidenceOverall: Number(document.confidence_overall ?? 1),
    note: null,
    complianceFailures: failures,
    findings,
    gstAtRisk: document.is_tax_invoice ? null : (document.tax_amount ?? null),
    belowTaxInvoiceThreshold: Number(payable) < 82.5,
    workspace: document.workspace_kind === 'personal' ? ('personal' as const) : ('business' as const),
    workspaceId: document.tenant_id,
    capturedByName: document.created_by_name,
    visibility: document.visibility === 'private' ? ('private' as const) : ('shared' as const),
    lines: wireLines,
    // Same rule as the extractor and the validator, imported rather than
    // restated: ex-GST lines on a tax invoice are balanced, and a third
    // private copy of this arithmetic is a third thing to get wrong.
    linesBalance:
      wireLines.length > 0 &&
      Math.abs(linesGap(lineSum, payable, document.tax_amount ?? null)) < 0.005,
    // §8 of the multi-page capture contract: a relative *authenticated*
    // route here has never actually worked — `<Image source={{uri}}>` cannot
    // attach an `Authorization` header, and on web `react-native-web` renders
    // a plain `<img>`, which cannot either. A signed, short-TTL token minted
    // fresh on every read (never stored) is the fix; the field's SHAPE is
    // unchanged, only what is in it. `0` is the image token's convention for
    // "the capture's original bytes" — see `Payload.p` in `tokens.ts`.
    imageUrl: `/v1/images/${issueImageToken(document.capture_id, document.tenant_id, 0)}`,
    imageCapturedAt: null,
    // §3.1 of the multi-page capture contract: without this, paging only
    // ever worked off the device's own local URIs, so reopening a document
    // later showed page 1 and nothing else. One entry per stored page,
    // ordered, and never empty for a document that actually has pages — a
    // caller that has to special-case "no array" vs "one implicit page"
    // eventually gets it backwards.
    pages: pages.map((p) => ({
      pageNumber: p.page_number,
      imageUrl: `/v1/images/${issueImageToken(document.capture_id, document.tenant_id, p.page_number)}`,
      source: p.source as PageSource,
    })),
    version: document.version,
  };
}

/**
 * Documents: what the extraction produced, and what a human does about it.
 *
 * The compliance verdict is RE-DERIVED on every correction rather than edited.
 * A user fixing an ABN is not asserting that the document is now a valid tax
 * invoice — the validators decide that, from the same rules that produced the
 * original verdict. Letting the client send `isTaxInvoice` would make the GST
 * credit a client-controlled field.
 */
@ApiTags('documents')
@Controller('v1/documents')
@UseGuards(SessionGuard, MembershipGuard)
export class DocumentsController {
  @Get()
  @ApiOperation({ summary: 'Documents in a workspace' })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('filter') filter?: string,
  ) {
    const allowed = ['all', 'needs_review', 'at_risk'] as const;
    const chosen = allowed.includes(filter as never)
      ? (filter as (typeof allowed)[number])
      : 'all';
    const rows = await listDocuments(user.userId, tenantId, chosen);
    // Lines and pages are not fetched for a list, for the same reason: 500
    // documents with their lines (or their pages) is a payload nobody
    // scrolls, and the review screen fetches both on open. The list view
    // never pages through a document, so there is no reader here for the
    // "never empty" invariant on `pages` to protect.
    return rows.map((row) => toWire(row, [], []));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One document, with its lines' })
  async get(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    const found = await getDocument(user.userId, tenantId, id);
    if (!found) throw new NotFoundException('No such document.');
    const pages = await listCapturePages(user.userId, tenantId, found.document.capture_id);
    return toWire(found.document, found.lines, pages);
  }

  @Get(':id/pages/:pageNumber/image')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({
    summary: 'One stored page, as captured',
    description:
      'The bytes for a single page of a multi-page document — see `DocumentView.pages`. Like `/image`, this is never re-encoded or enhanced after storage; a `pdf_native` or `pdf_render` page is the rasterisation made at intake, not a live re-render.',
  })
  async pageImage(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @Param('pageNumber') pageNumberRaw: string,
    @Res() reply: { header: (k: string, v: string) => void; send: (b: Buffer) => void },
  ): Promise<void> {
    const pageNumber = Number(pageNumberRaw);
    const found = await getDocument(user.userId, tenantId, id);
    if (!found) throw new NotFoundException('No such document.');
    const pages = await listCapturePages(user.userId, tenantId, found.document.capture_id);
    const page = pages.find((p) => p.page_number === pageNumber);
    if (!page) throw new NotFoundException('No such page.');
    // Read through the storage layer, which refuses any key that resolves
    // outside the storage root — the page number came from a client.
    const bytes = readObject(page.storage_key);
    reply.header('Content-Type', page.mime_type);
    reply.send(bytes);
  }

  @Get(':id/image')
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({
    summary: 'The original image',
    description:
      'The bytes exactly as captured — never re-encoded, cropped or enhanced. Under the ATO rules an electronic copy is acceptable only if it is a true and clear reproduction, so this IS the record; the extraction is the derived convenience.',
  })
  async image(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @Res() reply: { header: (k: string, v: string) => void; send: (b: Buffer) => void },
  ): Promise<void> {
    const capture = await getCaptureForDocument(user.userId, tenantId, id);
    if (!capture) throw new NotFoundException('No such document.');
    // Read through the storage layer, which refuses any key that resolves
    // outside the storage root — the document id came from a client.
    const bytes = readObject(capture.key);
    reply.header('Content-Type', capture.mime);
    reply.send(bytes);
  }

  @Patch(':id/visibility')
  @ApiOperation({
    summary: 'Share a document with the workspace, or keep it to yourself',
    description:
      'A private document stays visible to whoever captured it. This is for the household case — a birthday present is not something the rest of the family should see in the timeline — and it is NOT a security boundary between members of a business.',
  })
  async visibility(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(VisibilityDto) body: VisibilityDto,
  ): Promise<DocumentView> {
    const result = await updateDocument(user.userId, tenantId, id, {
      visibility: body.visibility,
    });
    if (!result.ok) throw new NotFoundException('No such document.');
    const after = await getDocument(user.userId, tenantId, id);
    if (!after) throw new NotFoundException('No such document.');
    const pages = await listCapturePages(user.userId, tenantId, after.document.capture_id);
    return toWire(after.document, after.lines, pages);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Correct a document',
    description:
      'Re-derives GST and the compliance verdict from the corrected values. Send `version` to get a 409 instead of silently overwriting a colleague.',
  })
  async update(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(UpdateDocumentDto) body: UpdateDocumentDto,
  ) {
    const before = await getDocument(user.userId, tenantId, id);
    if (!before) throw new NotFoundException('No such document.');

    // The wire speaks field paths; everything below this line works in flat
    // columns. One translation, at the boundary, rather than a second
    // vocabulary leaking through the handler.
    const edit = flattenEdits(body.edits);

    // Correcting the total re-derives the tax. GST is never taken from the
    // client: it is exactly 1/11 of the taxable part, and accepting both
    // invites the two to disagree.
    let taxAmount: string | undefined;
    let taxExclusiveAmount: string | undefined;
    const payable = edit.payableAmount ?? before.document.payable_amount;
    if (edit.payableAmount != null || edit.gstFreeAmount !== undefined) {
      const gstFree = money.money(edit.gstFreeAmount ?? '0');
      const taxable = money.subtract(money.money(payable ?? '0'), gstFree);
      taxAmount = money.gstFromInclusive(taxable);
      taxExclusiveAmount = money.subtract(money.money(payable ?? '0'), money.money(taxAmount));
    }

    const abn =
      edit.supplierAbn === undefined
        ? before.document.supplier_abn
        : (edit.supplierAbn?.replace(/\D/g, '') || null);

    // The verdict is recomputed from the rules, not sent by the client.
    const verdict = validate({
      schemaVersion: '1',
      docType: { value: 'receipt', confidence: 1 },
      saysTaxInvoice: {
        // Not something a correction can change: it is a fact about the paper.
        value: before.document.is_tax_invoice || (before.document.ato_compliance?.failures ?? []).indexOf('not_marked_tax_invoice') < 0,
        confidence: 1,
      },
      documentNumber: { value: null, confidence: 1 },
      issueDate: { value: edit.issueDate ?? before.document.issue_date, confidence: 1 },
      currency: { value: before.document.currency, confidence: 1 },
      supplierName: {
        value: edit.supplierName ?? before.document.supplier_name,
        confidence: 1,
      },
      supplierAbn: { value: abn, confidence: 1 },
      buyerIdentified: {
        value: (before.document.ato_compliance?.failures ?? []).indexOf('buyer_abn_required_over_1000') < 0,
        confidence: 1,
      },
      taxExclusiveAmount: { value: taxExclusiveAmount ?? before.document.tax_exclusive_amount, confidence: 1 },
      taxAmount: { value: taxAmount ?? before.document.tax_amount, confidence: 1 },
      payableAmount: { value: payable, confidence: 1 },
      lines: [],
      notes: { legible: true, imageIssues: [], warnings: [] },
    });

    const outcome = await updateDocument(
      user.userId,
      tenantId,
      id,
      {
        supplierName: edit.supplierName,
        supplierAbn: edit.supplierAbn === undefined ? undefined : abn,
        issueDate: edit.issueDate,
        payableAmount: edit.payableAmount,
        taxAmount,
        taxExclusiveAmount,
        isTaxInvoice: verdict.isTaxInvoice,
        // Visibility has its own endpoint; a correction never changes who
        // can see a document.
        atoCompliance: { failures: verdict.complianceFailures, findings: verdict.findings },
      },
      body.version,
    );

    if (!outcome.ok) {
      if (outcome.reason === 'missing') throw new NotFoundException('No such document.');
      throw new ConflictException(
        'Someone else changed this document while you were editing it. Reload and try again.',
      );
    }

    const after = await getDocument(user.userId, tenantId, id);
    const afterPages = await listCapturePages(user.userId, tenantId, after!.document.capture_id);
    return toWire(after!.document, after!.lines, afterPages);
  }

  @Put(':id/lines')
  @ApiOperation({ summary: 'Replace the lines, as a set' })
  async lines(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(ReplaceLinesDto) body: ReplaceLinesDto,
  ) {
    await replaceLines(user.userId, tenantId, id, body.lines);
    const after = await getDocument(user.userId, tenantId, id);
    if (!after) throw new NotFoundException('No such document.');
    const pages = await listCapturePages(user.userId, tenantId, after.document.capture_id);
    return toWire(after.document, after.lines, pages);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm and post to the ledger',
    description: 'Records who confirmed it and when. Locks the checked fields against re-extraction.',
  })
  async confirm(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ) {
    // Whether this user MAY confirm is a role question. Until roles are
    // enforced server-side, the client hides the action for a member — which
    // is a UI convenience, not a control, and is called out as such here so
    // nobody mistakes it for one.
    const members = await listMembers(user.userId, tenantId);
    const role = members.find((m) => m.user_id === user.userId)?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new ConflictException('Posting to the ledger is an owner or manager action.');
    }

    const outcome = await updateDocument(user.userId, tenantId, id, {
      reviewStatus: 'reviewed',
    });
    if (!outcome.ok) throw new NotFoundException('No such document.');
    const after = await getDocument(user.userId, tenantId, id);
    const pages = await listCapturePages(user.userId, tenantId, after!.document.capture_id);
    return toWire(after!.document, after!.lines, pages);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject a mis-scan',
    description:
      'Withdraws the reading. The capture is kept — the image is the record a business must hold for five years.',
  })
  async reject(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
    @ValidBody(RejectDto) body: RejectDto,
  ): Promise<{ rejected: true }> {
    void body;
    const outcome = await updateDocument(user.userId, tenantId, id, {
      reviewStatus: 'rejected',
    });
    if (!outcome.ok) throw new NotFoundException('No such document.');
    return { rejected: true };
  }
}

export { abnIsValid };
