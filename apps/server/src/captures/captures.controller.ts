import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CapturePageInput, CreateCaptureResponse, StatementBalanceCheck } from '@snap/api-contract';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { config } from '../config.js';
import { demuxPdf } from '../extraction/pdf.js';
import {
  countExtractionsToday,
  createCapture,
  enqueueExtraction,
  finalizeCapturePages,
  getCaptureProgress,
  listCapturePages,
  markCaptureStored,
  recordCapturePage,
} from '../repo.js';
import { put as storagePut } from '../storage.js';
import { importCsvStatement } from '../statements/csv-import.js';
import { issueUploadToken, readUploadToken } from '../tokens.js';
import { pageKey, putAtKey } from './page-storage.js';

/**
 * The largest capture this endpoint admits, in PAGES — receipts and
 * statements share one cap here (`docs/STATEMENTS.md` §12, Lane T, T7).
 *
 * The old cap was 20, sized for a photographed receipt or a short multi-page
 * tax invoice. `docs/STATEMENTS.md` §5.6 names the shape that does not fit
 * under it: "**A 40-page annual statement does not fit under the current
 * caps** and something has to give." That figure — 40 pages, the largest
 * statement the document says the product intends to accept — is the one
 * piece of actual evidence in this repository for where the line should sit.
 * Everything past it is a judgement call, labelled as one: 10 pages of
 * headroom above that figure (a cover page, a fees schedule, an
 * off-by-a-page recount from the client), landing on 50. Nothing here
 * measures a real institution's longest statement, so the buffer is not
 * presented as more than a guess with a stated margin.
 *
 * This one constant now bounds two different things that used to be bounded
 * (or not bounded at all) separately:
 *
 *  1. How many pages a client may DECLARE up front in `CreateCaptureDto`,
 *     below — the shape a capture built from individually photographed or
 *     scanned statement pages takes.
 *  2. How many physical pages a single uploaded PDF may DEMUX into — checked
 *     in `upload()`, after `demuxPdf`. Before this change that axis had NO
 *     cap at all: a PDF always declares exactly ONE page at capture-creation
 *     time (the "PDF must be the only page in its capture" rule a few dozen
 *     lines below), so the declared-pages cap never applied to it. A 5,000
 *     page PDF sailed through registration and was refused nowhere before
 *     hitting whatever timeout or OOM the worker met first — an unbounded,
 *     unpredictable failure mode, not a deliberate one. This is the gap T7
 *     closes; a PDF over the cap is now refused here, by name, before a
 *     single byte is written to `capture_pages`.
 *
 * Cost consequence, reported rather than silently absorbed: a capture at this
 * cap costs the extraction worker up to 2.5x what the old 20-page cap ever
 * allowed. §5.2/T2 already chunks per-page extraction to avoid
 * `TruncatedOutputError`, but nothing here changes worker-side timeouts or
 * per-page billing for the new ceiling — that is this ticket's reported
 * follow-up, not something this endpoint can absorb on its own.
 */
const MAX_CAPTURE_PAGES = 50;

/**
 * The per-tenant DAILY extraction budget, refused at intake with 429 — the
 * second half of Task 10's cost caps (the first being
 * `pdf-statement-import.ts`'s `MAX_STATEMENT_PAGES`, which bounds what ONE
 * document may cost; this bounds what ONE tenant may spend in a day).
 *
 * `MAX_CAPTURE_PAGES` above bounds a single capture's TRANSPORT; it never
 * bounded volume. Ten thousand one-page receipts in a day was ten thousand
 * paid model calls, one legal capture at a time — and unlike the page cap,
 * this one sits at INTAKE because the decision it makes is "not today",
 * which only the request path can answer.
 *
 * The TODO this replaces said "quotaExhausted: left unset. Nothing in this
 * endpoint currently reads the plan" — the contract field
 * (`CreateCaptureResponse.quotaExhausted`) always meant a state the client
 * should be TOLD about, and this is that state, decided by one counter
 * query (`repo.countExtractionsToday`) against today's `extract` jobs for
 * the tenant, gated by `config.EXTRACTION_DAILY_BUDGET`.
 */
async function refuseWhenExtractionBudgetSpent(usedToday: number): Promise<void> {
  const budget = config().EXTRACTION_DAILY_BUDGET;
  if (usedToday >= budget) {
    throw new HttpException(
      {
        error: 'quota_exhausted',
        message:
          `This workspace has used all ${budget} of its extractions for today. ` +
          'Captures already stored are safe — more can be taken tomorrow.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class CapturePageInputDto {
  /** Hex SHA-256 of THIS PAGE's bytes. Advisory: the server recomputes it. */
  @Matches(/^[0-9a-f]{64}$/i, { message: 'sha256 must be 64 hex characters.' })
  sha256!: string;

  /**
   * `text/csv` added for `docs/STATEMENTS.md` T5 — mode (c), a bank CSV
   * export. `apps/mobile/src/lib/file-intake.ts`'s `resolvePickedMimeType`
   * already declares exactly this string for a picked CSV (never a spelling
   * variant), so the wire contract only needs to accept the one value a real
   * client sends — no `text/comma-separated-values`, no
   * `application/vnd.ms-excel`, both of which that function already
   * normalises away before this DTO ever sees them.
   */
  @Matches(/^(image\/[a-z0-9.+-]+|application\/pdf|text\/csv)$/i, {
    message: 'mimeType must be an image type, application/pdf, or text/csv.',
  })
  mimeType!: string;

  /**
   * 30 MB, UNCHANGED by T7 — deliberately, not by oversight.
   *
   * This is not headroom picked to be comfortable; it is close to a hard
   * ceiling this endpoint does not control. `main.ts`'s `FastifyAdapter` is
   * constructed with `bodyLimit: 32 * 1024 * 1024`, and the raw-body content
   * parsers registered there for `image/*` and `application/pdf` carry the
   * same 32 MB limit — both outside the file this ticket owns. A single PUT
   * to `/v1/uploads/:token` cannot physically deliver more than 32 MB
   * regardless of what this DTO declares, so raising this past ~30 MB would
   * advertise a cap the transport already refuses to honour, which is worse
   * than the receipt-sized cap it would replace. A real statement's larger
   * byte size is the DECLARED-PAGE-COUNT axis above, not this one: a 40-page
   * statement is either one native PDF file (typically low-single-digit MB
   * for real text, well inside 30 MB) or up to 40 individually photographed
   * pages, each its own 30 MB budget. Raising the true ceiling would mean
   * touching `main.ts`'s Fastify body limit, which is outside this ticket's
   * file list — reported as a follow-up rather than silently left unstated.
   */
  @IsInt()
  @Min(1)
  @Max(30 * 1024 * 1024, { message: 'That page is larger than 30 MB.' })
  byteSize!: number;
}

export class CreateCaptureDto {
  /**
   * 1..MAX_CAPTURE_PAGES, in page order. The OLD flat `{sha256, mimeType,
   * byteSize, pageCount}` shape is gone outright — see
   * `docs/contracts/phase0-multipage.md` §3 — because nothing had shipped
   * against it.
   */
  @IsArray()
  @ArrayMinSize(1, { message: 'A capture needs at least one page.' })
  @ArrayMaxSize(MAX_CAPTURE_PAGES, {
    message: `A capture cannot declare more than ${MAX_CAPTURE_PAGES} pages.`,
  })
  @ValidateNested({ each: true })
  @Type(() => CapturePageInputDto)
  pages!: CapturePageInputDto[];

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  legibilityScore?: number;
}

/**
 * Capture intake.
 *
 * Three steps, deliberately separate:
 *
 *  1. `POST /v1/captures` registers the intent and answers the one question
 *     worth asking before an upload: do you already have these bytes? A
 *     duplicate costs the client nothing and prevents two claims for one
 *     expense. Now answered PER PAGE as well as for the whole document — a
 *     tax invoice is not one photo, and re-photographing page 2 of a receipt
 *     you already captured should not re-upload page 1.
 *  2. `PUT /v1/uploads/:token` receives the bytes, one page at a time. In
 *     production the token is a presigned S3 URL and the bytes never touch
 *     this process — which is why it is a separate call with its own
 *     credential rather than a multipart field on step 1.
 *  3. Extraction is QUEUED, not awaited, and queued exactly ONCE per capture
 *     — after the LAST declared page arrives, never once per page. A model
 *     takes seconds; holding an HTTP request open for that is how a mobile
 *     client on a truck-stop connection times out and re-uploads. Running it
 *     once per page would also hand the worker a half-uploaded document.
 */
@ApiTags('captures')
@Controller('v1')
export class CapturesController {
  @Post('captures')
  @UseGuards(SessionGuard, MembershipGuard)
  @ApiOperation({
    summary: 'Register a multi-page capture and get somewhere to upload each page',
    description:
      'Deduplicates on the WHOLE-DOCUMENT content hash before any bytes move — a duplicate returns the existing capture id and `duplicate: true` — and separately on each page, so bytes already held under any capture in this tenant are never re-uploaded.',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(CreateCaptureDto) body: CreateCaptureDto,
  ): Promise<CreateCaptureResponse> {
    const declared: CapturePageInput[] = body.pages.map((p) => ({
      sha256: p.sha256.toLowerCase(),
      mimeType: p.mimeType,
      byteSize: p.byteSize,
    }));

    const { capture, duplicate, pages: plan } = await createCapture(user.userId, tenantId, {
      pages: declared,
      capturedAt: body.capturedAt,
      legibilityScore: body.legibilityScore,
    });

    // The daily extraction budget — ONE counter query, after registration
    // so `duplicate` is known (a duplicate is never refused: its document
    // already exists and no new extraction would be queued for it anyway).
    // Fresh work over the budget is refused 429; the row this call already
    // stored is harmless — re-sending the same bytes re-enters here as a
    // duplicate and is answered with `quotaExhausted: true` rather than
    // hung, which is what the response field has always promised the
    // client ("the capture is still stored; extraction waits").
    const usedToday = await countExtractionsToday(user.userId, tenantId);
    const quotaExhausted = usedToday >= config().EXTRACTION_DAILY_BUDGET;
    if (quotaExhausted && !duplicate) {
      await refuseWhenExtractionBudgetSpent(usedToday);
    }

    const uploadExpiresAt = new Date(Date.now() + config().UPLOAD_TTL_SECONDS * 1000).toISOString();
    const uploads = plan.map((p) => ({
      pageNumber: p.pageNumber,
      // Relative, so the client works behind whatever host or tunnel it
      // reaches us through — a demo runs through an SSH tunnel as often as not.
      uploadUrl: `/v1/uploads/${issueUploadToken(capture.id, tenantId, p.pageNumber, declared.length)}`,
      alreadyStored: p.alreadyStored,
    }));

    if (!duplicate) {
      // A page `createCapture` already found in storage — identical bytes
      // captured before, in this tenant, possibly under a different capture
      // — is recorded against THIS capture immediately. Nobody will ever PUT
      // it: the client is told to skip it via `alreadyStored`.
      for (const p of plan) {
        if (!p.alreadyStored || !p.storageKey) continue;
        const source = declared[p.pageNumber - 1]!;
        await recordCapturePage(user.userId, tenantId, {
          captureId: capture.id,
          pageNumber: p.pageNumber,
          storageKey: p.storageKey,
          mimeType: source.mimeType,
          byteSize: source.byteSize,
          sha256: source.sha256,
          // `capture_pages` only ever holds rasterised bytes; a declared page
          // whose hash matched something already on disk can only be an
          // ordinary photo in practice (a PDF's own file hash essentially
          // never coincides with a previously rendered page's hash). This is
          // a best-effort tag for that edge case, not a claim it is common.
          source: source.mimeType === 'application/pdf' ? 'pdf_render' : 'capture',
        });
      }

      // If EVERY declared page arrived pre-stored, no PUT will ever happen —
      // the only other place extraction is enqueued is the upload handler
      // below, once the last PENDING page lands — so it has to be queued
      // here instead. A duplicate capture never re-queues: its document
      // already exists, or is already being produced, under the original
      // capture that first captured these bytes.
      if (plan.length > 0 && plan.every((p) => p.alreadyStored)) {
        await enqueueExtraction(user.userId, tenantId, capture.id);
      }
    }

    return {
      captureId: capture.id,
      uploads,
      uploadExpiresAt,
      duplicate,
      // Set whenever today's budget is spent. For a duplicate (the only
      // response this method produces while exhausted) it tells the client
      // why nothing new will be extracted — see the counter query above.
      quotaExhausted: quotaExhausted || undefined,
      // uploadUrl is a deprecated alias for uploads[0].uploadUrl; keep it in
      // lockstep with that array, never independently stale.
      uploadUrl: uploads[0]?.uploadUrl ?? '',
    };
  }

  @Get('captures/:id')
  @UseGuards(SessionGuard, MembershipGuard)
  @ApiOperation({
    summary: 'How far a capture has got',
    description:
      'Polled after an upload while the worker runs. Answers with the DOCUMENT ID once there is one — the client must not have to guess which of a shared workspace’s newest documents is the one it just captured.',
  })
  async progress(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ): Promise<{
    status: string;
    ready: boolean;
    documentId: string | null;
    error: string | null;
  }> {
    const found = await getCaptureProgress(user.userId, tenantId, id);
    if (!found) throw new NotFoundException('No such capture.');
    return {
      status: found.status,
      // A document exists, so the client can stop asking. `failed` is also a
      // terminal state and is reported as an error rather than polled forever.
      ready: found.documentId !== null,
      documentId: found.documentId,
      error: found.status === 'failed' ? (found.error ?? 'Extraction failed.') : null,
    };
  }

  @Put('uploads/:token')
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: 'Upload one page of the original bytes',
    description:
      'The body is the raw page — an image, a PDF, or (docs/STATEMENTS.md T5) a CSV statement export. The server recomputes the hash and stores the bytes unmodified — under the ATO rules the original is the legal record — then, for a PDF, expands it into its real pages (§4 of the multi-page capture contract); for a CSV, reads it directly into a statement, with no page image and no queued extraction at all.',
  })
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
    @Headers('content-type') contentType: string | undefined,
    @Req() request: { body?: unknown },
    // `docs/STATEMENTS.md` T5 — which `financial_accounts` row a CSV belongs
    // to. A query param, not a JSON body field: this endpoint's body IS the
    // raw file, and no client sends this today (there is no account-picker
    // UI yet) — see the T5 report for why a placeholder account is
    // auto-provisioned when it is absent, which is every real call right now.
    @Query('financialAccountId') financialAccountId?: string,
  ): Promise<{
    sha256: string;
    byteSize: number;
    queued: boolean;
    pages: number;
    statement?: { balanceCheck: StatementBalanceCheck; lineCount: number };
  }> {
    const claim = readUploadToken(token);
    // Expired or forged. Not distinguished, because the client can do nothing
    // different with the two and the difference is useful only to an attacker.
    if (!claim) throw new BadRequestException('That upload link is not valid or has expired.');

    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
      throw new BadRequestException('Send the page bytes as the request body.');
    }

    const normalisedType = (contentType ?? '').toLowerCase();
    const isPdf = normalisedType === 'application/pdf';
    const isCsv = normalisedType === 'text/csv';
    if (!isPdf && !isCsv && !/^image\//.test(normalisedType)) {
      throw new BadRequestException('Content-Type must be an image type, application/pdf, or text/csv.');
    }

    // A PDF demuxes into an a-priori unknown number of physical pages, which
    // this endpoint numbers starting at its own declared slot (see the demux
    // branch below). That numbering only stays collision-free against OTHER
    // declared pages in the same capture when the PDF is the only one — so,
    // for now, it must be. Splitting a multi-page PDF's photographed cover
    // page out as a separate declared entry is a real request; it needs
    // renumbering support this contract does not specify, so it is refused
    // rather than silently mis-ordered.
    if (isPdf && claim.pageCount > 1) {
      throw new BadRequestException(
        'A PDF must be the only page in its capture. Upload it on its own, or photograph the pages individually instead.',
      );
    }
    // A CSV is a whole statement, never one photo of one — the same rule as
    // a PDF, for the same reason (`apps/mobile/src/lib/file-intake.ts`'s
    // `assertFilePickAllowed` already enforces this client-side; this is the
    // server refusing to trust that alone).
    if (isCsv && claim.pageCount > 1) {
      throw new BadRequestException('A CSV must be the only page in its capture.');
    }

    if (isCsv) {
      // No page image, no `capture_pages` row, no queued extraction — §5.6
      // is explicit that mode (c) needs none of that ("Extraction needed:
      // None"). The original bytes still go through the same L0 "originals"
      // store a PDF's do, immediately above, for the same reason: the file
      // is the legal record, and `documents.capture_id` needs a `captures`
      // row whose `original_storage_key` actually resolves.
      const original = storagePut(claim.tenantId, bytes);
      await markCaptureStored(user.userId, claim.tenantId, claim.captureId, original.key);

      const result = await importCsvStatement(user.userId, claim.tenantId, {
        captureId: claim.captureId,
        bytes,
        financialAccountId,
      });
      if (!result.ok) {
        throw new BadRequestException(result.reason);
      }
      return {
        sha256: original.sha256,
        byteSize: bytes.byteLength,
        // Not queued: nothing further runs. `false` here is accurate, not a
        // downgrade — a receipt's `true` means "a worker will finish this
        // soon"; a CSV is already finished by the time this responds.
        queued: false,
        pages: 0,
        statement: { balanceCheck: result.balanceCheck, lineCount: result.lineCount },
      };
    }

    if (isPdf) {
      // The raw PDF, written to the L0 "originals" store BEFORE anything
      // else touches it — this was the missing half of "the PDF itself
      // stays the L0 original" a few lines below: that comment described
      // where `original_storage_key` should end up pointing, but nothing
      // ever wrote bytes there. `capture_pages` only ever holds RASTERISED
      // renders (below), never the PDF's own bytes or its text layer, so
      // without this write `original_storage_key` pointed at nothing —
      // `readObject` on it threw ENOENT — and any reader that needs the
      // real PDF (T1's statement classifier, `worker.ts`'s
      // `classifyCapture`, which runs `extractPdfText` against exactly this
      // key) silently got `null` back and fell through to the receipt path.
      //
      // `storage.put` — not `page-storage.ts`'s `pageKey`/`putAtKey` — is
      // used deliberately: that module is `storage.ts`'s own "single whole
      // document, content-addressed under `<tenant>/originals/`" primitive,
      // the same one an ordinary (non-multipage) capture already uses, and
      // it hashes the BYTES ACTUALLY RECEIVED rather than trusting the
      // client's declared hash from `POST /v1/captures` — the same rule
      // every other identity decision in this file already follows.
      // `markCaptureStored` — declared in `repo.ts`, previously called by
      // nothing — is exactly "correct `original_storage_key` once the real
      // bytes are known", so this wires it up rather than inventing a
      // second way to do the same update.
      //
      // Idempotent by construction: a retried PUT of the same PDF hashes to
      // the same key and overwrites it with identical bytes, and
      // `markCaptureStored` sets the same value again — no corruption, no
      // duplication, whether or not `alreadyDemuxed` (below) turns out true.
      //
      // Stated cost, not a silent one: storage roughly doubles for a PDF
      // capture — the original bytes here, plus every rasterised page below
      // (pages need pixels either way, for the model and for on-screen
      // paging). That is the intended L0-original / L1-derivative split
      // `storage.ts`'s own header describes, not a regression this
      // introduces.
      const original = storagePut(claim.tenantId, bytes);
      await markCaptureStored(user.userId, claim.tenantId, claim.captureId, original.key);

      // Read BEFORE recording anything, so a retried PUT — the same PDF,
      // re-sent because the first response never arrived — can tell "I
      // already finished this" from "this is the first attempt". Without it,
      // every retry of an already-demuxed PDF would queue another extraction
      // for the same capture, which is exactly the "never once per page" (or
      // per retry) rule this endpoint exists to hold.
      const alreadyDemuxed = (await listCapturePages(user.userId, claim.tenantId, claim.captureId)).length > 0;

      const rendered = await demuxPdf(bytes);
      if (rendered.length === 0) {
        throw new BadRequestException('That PDF has no pages to read.');
      }
      // A PDF declares exactly ONE page at capture-creation time (the
      // solo-PDF rule below), so `ArrayMaxSize(MAX_CAPTURE_PAGES)` on
      // `CreateCaptureDto.pages` never sees its true page count — only the
      // demux above reveals that. This is the check that actually stops a
      // 5,000-page PDF, checked before ANY page is written to
      // `capture_pages` or stored, so a refusal here leaves no partial
      // state to clean up.
      if (rendered.length > MAX_CAPTURE_PAGES) {
        throw new BadRequestException(
          `That PDF has ${rendered.length} pages, more than the ${MAX_CAPTURE_PAGES}-page cap.`,
        );
      }
      // In page order, for the capture-level dedup hash below.
      const pageHashes: string[] = [];
      for (let i = 0; i < rendered.length; i++) {
        const page = rendered[i]!;
        const sha256 = createHash('sha256').update(page.bytes).digest('hex');
        pageHashes.push(sha256);
        const storageKey = pageKey(claim.tenantId, sha256);
        putAtKey(storageKey, page.bytes);
        await recordCapturePage(user.userId, claim.tenantId, {
          captureId: claim.captureId,
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

      // The capture now has N pages where it declared one, so the two
      // columns that describe the document as a whole are recomputed from the
      // demuxed set. `original_sha256` matters most: it is what
      // `captures_sha_unique` enforces, so leaving it as the hash of a single
      // declared page would mean the same PDF uploaded twice no longer
      // deduplicates while the constraint still claims it cannot happen.
      //
      // The PDF itself stays the L0 original — `original_storage_key` and its
      // siblings are deliberately untouched by this call.
      const finalized = await finalizeCapturePages(
        user.userId,
        claim.tenantId,
        claim.captureId,
        pageHashes.map((sha256) => ({ sha256 })),
      );
      if (!finalized.ok) {
        // Two captures that looked different on upload turn out to be the
        // same document once rendered. Both rows are left intact — merging
        // them spans documents, runs and possibly a posted transaction, which
        // is not a decision an upload handler gets to make — and the client is
        // told which capture it already has, the same answer a duplicate gets
        // at registration time.
        throw new ConflictException({
          message: 'You already have this document. It was captured before under a different file.',
          captureId: finalized.duplicateCaptureId,
        });
      }

      if (!alreadyDemuxed) {
        // Budget re-checked HERE, not only at registration: a capture whose
        // pages finish uploading may cross the day's budget while its
        // registration did not. The bytes are already stored (this PUT just
        // wrote them), so nothing is lost — the capture waits, and the 429
        // tells the client extraction did not start today.
        await refuseWhenExtractionBudgetSpent(await countExtractionsToday(user.userId, claim.tenantId));
        await enqueueExtraction(user.userId, claim.tenantId, claim.captureId);
      }

      return {
        sha256: original.sha256,
        byteSize: bytes.byteLength,
        queued: true,
        pages: rendered.length,
      };
    }

    // Read BEFORE recording, for the same reason as the PDF branch above: it
    // is what lets a retried PUT for a page that already arrived recognise
    // that the capture was ALREADY complete, rather than re-crossing the
    // "last page" threshold and queuing a second extraction.
    const before = await listCapturePages(user.userId, claim.tenantId, claim.captureId);
    const alreadyComplete = before.length >= claim.pageCount;

    // Written under the hash OF THE RECEIVED BYTES. The client's hash decided
    // whether to bother uploading; it never decides the identity of a record.
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = pageKey(claim.tenantId, sha256);
    putAtKey(storageKey, bytes);
    await recordCapturePage(user.userId, claim.tenantId, {
      captureId: claim.captureId,
      pageNumber: claim.pageNumber,
      storageKey,
      mimeType: contentType ?? 'application/octet-stream',
      byteSize: bytes.byteLength,
      sha256,
      source: 'capture',
    });

    // Enqueue exactly once, after the LAST declared page arrives — checked
    // by recounting rather than trusting `claim.pageNumber === claim.pageCount`,
    // because pages need not arrive in order. `capture_pages` is upserted per
    // page number, so a retried page never inflates the count; `alreadyComplete`
    // is what stops that retry from re-queuing a capture that already got there.
    if (!alreadyComplete) {
      const after = await listCapturePages(user.userId, claim.tenantId, claim.captureId);
      if (after.length >= claim.pageCount) {
        // Budget re-checked here for the same reason as the PDF branch
        // above: the last page of a multi-page capture can cross the day's
        // budget after its registration was admitted.
        await refuseWhenExtractionBudgetSpent(await countExtractionsToday(user.userId, claim.tenantId));
        await enqueueExtraction(user.userId, claim.tenantId, claim.captureId);
      }
    }

    return { sha256, byteSize: bytes.byteLength, queued: true, pages: 1 };
  }
}
