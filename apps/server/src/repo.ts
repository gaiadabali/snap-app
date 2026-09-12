import { createHash, randomUUID } from 'node:crypto';

import { NotAMemberError, listWorkspacesFor, withTenant, withTenantAs, type Tx } from '@snap/db';
import type {
  AuthUser,
  CapturePageInput,
  ComplianceFailure,
  ExtractionFinding,
} from '@snap/api-contract';
import { sql } from 'drizzle-orm';

import { getDb } from './db.js';
import type { ValidatedExtraction } from './extraction/types.js';

/**
 * Every database access the API makes.
 *
 * One module, so there is one place to audit how tenant scoping is applied.
 * Two rules hold throughout:
 *
 *  1. Nothing talks to the database except through `withTenantAs`, which
 *     verifies in the same transaction that the caller is a member of the
 *     tenant before any tenant context exists. The endpoints never pass a
 *     tenant id they have not been given by the client, and the client can
 *     pass anything — so the check cannot live in the endpoint.
 *  2. SQL is parameterised. Not once, anywhere, is a value interpolated into
 *     a query string, including ids that "came from us".
 */

export { NotAMemberError, listWorkspacesFor };

/* ── Users and sessions ─────────────────────────────────────────────────── */

type IdentityRow = { user_id: string; email: string; display_name: string };

/**
 * The two letters every client shows in an avatar.
 *
 * Computed HERE, not in each client, because the contract says so and because
 * two clients disagreeing about a person's initials is the sort of difference
 * nobody notices until a screenshot in a bug report shows the wrong one.
 */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function toAuthUser(row: IdentityRow): AuthUser {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    initials: initialsOf(row.display_name),
  };
}

/**
 * Finds or creates the user for an email address.
 *
 * Goes through `identity_sign_in`, not through a statement of our own. The app
 * role is NOSUPERUSER NOBYPASSRLS, so `users` is genuinely protected by RLS
 * and there is no tenant context yet to satisfy any policy — which is correct,
 * because creating an identity is not an ordinary tenant write. Migration 0015
 * explains the whole arrangement; the short version is that the rule lives in
 * SQL, owned by a NOLOGIN role, instead of in a privilege the server holds all
 * day for the sake of one request.
 *
 * Authentication has already happened by the time this runs: the address is
 * proven, and this only decides which row it corresponds to.
 */
export async function upsertUserByEmail(email: string, displayName: string): Promise<AuthUser> {
  const rows = await getDb().execute<IdentityRow>(sql`
    select user_id, email, display_name
      from identity_sign_in(${`dev|${email}`}, ${email}, ${displayName})
  `);
  const row = rows.rows[0];
  if (!row) throw new Error('identity_sign_in returned no row');
  return toAuthUser(row);
}

/** The caller's own row, by id. Read on every authenticated request. */
export async function getUser(userId: string): Promise<AuthUser | null> {
  const rows = await getDb().execute<IdentityRow>(sql`
    select user_id, email, display_name from identity_user(${userId})
  `);
  const row = rows.rows[0];
  return row ? toAuthUser(row) : null;
}

/**
 * The seeded demo accounts.
 *
 * Recognised by their address, not by a flag on the row: a `is_demo` column
 * would be one more thing that can be true in production. These addresses are
 * the ones `scripts/seed.ts` creates and they exist nowhere else.
 *
 * Goes through `identity_user` per id rather than selecting from `users`,
 * because the app role genuinely cannot read that table (migration 0015).
 */
export async function listDemoAccounts(): Promise<AuthUser[]> {
  const ids = [
    '33333333-3333-4333-8333-333333333331',
    '33333333-3333-4333-8333-333333333332',
    '33333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333334',
    '33333333-3333-4333-8333-333333333335',
  ];
  const found = await Promise.all(ids.map((id) => getUser(id)));
  return found.filter((u): u is NonNullable<typeof u> => u !== null);
}

/* ── Captures ───────────────────────────────────────────────────────────── */

export type CaptureRow = {
  id: string;
  sha256: string;
  status: string;
};

/** What `createCapture` reports back for one requested page. */
export type CapturePagePlan = {
  pageNumber: number;
  /** null only when the whole document is a duplicate and this page number
   *  was never recorded against it (the request declared more pages than the
   *  document it matched actually has). */
  storageKey: string | null;
  alreadyStored: boolean;
};

/**
 * Content-addressed storage key for one page's bytes.
 *
 * Deterministic from the hash alone, so two requests for the same bytes
 * agree on the key without a round trip, and `alreadyStored` can be answered
 * by checking whether anything was ever written to it.
 */
function pageStorageKey(tenantId: string, sha256Hex: string): string {
  return `${tenantId}/pages/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
}

/**
 * The capture-level dedup hash — `captures.original_sha256` — documented
 * next to the column in migration 0018.
 *
 * One page: that page's own hash, so a single-page capture dedupes exactly
 * as it always has. More than one: SHA-256 of the page hashes, concatenated
 * as lowercase hex TEXT in page order, then hashed as that text — not the
 * decoded bytes, and not order-independent, because two documents whose
 * pages arrived in a different order are not the same document. A PDF
 * demuxed into a different page count than declared here (lane B) must
 * reproduce this exact computation over the demuxed pages or the uniqueness
 * constraint stops meaning "the same document".
 */
function captureDedupHash(pages: readonly { sha256: string }[]): string {
  if (pages.length === 1) return pages[0]!.sha256.toLowerCase();
  const concatenated = pages.map((p) => p.sha256.toLowerCase()).join('');
  return createHash('sha256').update(concatenated, 'utf8').digest('hex');
}

/** Pages of an already-known capture, in page order. Shared by the two
 *  `createCapture` paths that need to answer "what does this capture have". */
async function readCapturePagesTx(
  tx: Tx,
  captureId: string,
): Promise<Array<{ page_number: number; storage_key: string }>> {
  const rows = await tx.execute<{ page_number: number; storage_key: string }>(sql`
    select page_number, storage_key from capture_pages
     where capture_id = ${captureId}
     order by page_number
  `);
  return rows.rows;
}

function planFromExisting(
  requestedPageCount: number,
  existing: Array<{ page_number: number; storage_key: string }>,
): CapturePagePlan[] {
  const byNumber = new Map(existing.map((p) => [p.page_number, p.storage_key]));
  return Array.from({ length: requestedPageCount }, (_, i) => {
    const pageNumber = i + 1;
    const storageKey = byNumber.get(pageNumber) ?? null;
    return { pageNumber, storageKey, alreadyStored: storageKey != null };
  });
}

/**
 * Registers a capture — one or more pages, the whole document — or returns
 * the existing one for an identical set of pages.
 *
 * The uniqueness is enforced by the database — `UNIQUE (tenant_id,
 * original_sha256)`, keyed on the capture-level dedup hash above — not by
 * this read-then-write, which could race two simultaneous uploads of the
 * same docket. The select is a fast path for the common case; the insert's
 * conflict handler is what makes it correct.
 *
 * `original_storage_key` / `original_mime_type` / `original_byte_size` are
 * set from PAGE 1 ONLY (migration 0018) — every existing reader of a capture
 * keeps working against a single-page shape without knowing pages exist.
 */
export async function createCapture(
  userId: string,
  tenantId: string,
  input: {
    pages: CapturePageInput[];
    capturedAt?: string;
    legibilityScore?: number;
  },
): Promise<{ capture: CaptureRow; duplicate: boolean; pages: CapturePagePlan[] }> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const dedupHash = captureDedupHash(input.pages);

    const existing = await tx.execute<CaptureRow>(sql`
      select id, encode(original_sha256, 'hex') as sha256, status::text as status
        from captures
       where original_sha256 = decode(${dedupHash}, 'hex')
       limit 1
    `);
    const found = existing.rows[0];
    if (found) {
      const existingPages = await readCapturePagesTx(tx, found.id);
      return {
        capture: found,
        duplicate: true,
        pages: planFromExisting(input.pages.length, existingPages),
      };
    }

    const id = randomUUID();
    const page1 = input.pages[0]!;
    const inserted = await tx.execute<CaptureRow>(sql`
      insert into captures (
        id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
        original_byte_size, original_sha256, page_count, captured_at, legibility_score
      ) values (
        ${id}, ${tenantId}, ${userId},
        ${pageStorageKey(tenantId, page1.sha256)},
        ${page1.mimeType}, ${page1.byteSize}, decode(${dedupHash}, 'hex'),
        ${input.pages.length},
        ${input.capturedAt ?? null}, ${input.legibilityScore ?? null}
      )
      on conflict (tenant_id, original_sha256) do nothing
      returning id, encode(original_sha256, 'hex') as sha256, status::text as status
    `);

    const row = inserted.rows[0];
    if (!row) {
      // The conflict handler fired: another request inserted the same
      // document between our select and our insert. Read it back rather
      // than failing — to the user, photographing the same receipt twice
      // (even page by page, in a race) is not an error.
      const raced = await tx.execute<CaptureRow>(sql`
        select id, encode(original_sha256, 'hex') as sha256, status::text as status
          from captures where original_sha256 = decode(${dedupHash}, 'hex') limit 1
      `);
      const racedCapture = raced.rows[0]!;
      const existingPages = await readCapturePagesTx(tx, racedCapture.id);
      return {
        capture: racedCapture,
        duplicate: true,
        pages: planFromExisting(input.pages.length, existingPages),
      };
    }

    // Per-page dedup, independent of the capture-level one above: these exact
    // bytes may already sit in storage from an unrelated capture (the same
    // receipt re-photographed into a different bundle). Content-addressed
    // keys make that safe to detect and skip re-uploading, page by page.
    const pages: CapturePagePlan[] = [];
    for (let i = 0; i < input.pages.length; i++) {
      const page = input.pages[i]!;
      const dupe = await tx.execute<{ storage_key: string }>(sql`
        select storage_key from capture_pages
         where tenant_id = ${tenantId} and sha256 = decode(${page.sha256}, 'hex')
         limit 1
      `);
      const already = dupe.rows[0];
      pages.push({
        pageNumber: i + 1,
        storageKey: already?.storage_key ?? pageStorageKey(tenantId, page.sha256),
        alreadyStored: already != null,
      });
    }

    return { capture: row, duplicate: false, pages };
  });
}

/**
 * Records one page's bytes as stored.
 *
 * An UPSERT, not a plain insert, for two reasons that both come from the
 * contract this backs (`docs/contracts/phase0-multipage.md` §4): a failed
 * page is retried at the SAME page number rather than restarting the whole
 * capture, and a demuxed PDF replaces its single placeholder page with the
 * real per-page rows at those same page numbers. Neither is an error case.
 */
export async function recordCapturePage(
  userId: string,
  tenantId: string,
  input: {
    captureId: string;
    pageNumber: number;
    storageKey: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    width?: number;
    height?: number;
    source?: 'capture' | 'pdf_native' | 'pdf_render';
  },
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    await tx.execute(sql`
      insert into capture_pages (
        id, tenant_id, capture_id, page_number, storage_key, mime_type,
        byte_size, sha256, width, height, source
      ) values (
        ${randomUUID()}, ${tenantId}, ${input.captureId}, ${input.pageNumber},
        ${input.storageKey}, ${input.mimeType}, ${input.byteSize},
        decode(${input.sha256}, 'hex'), ${input.width ?? null}, ${input.height ?? null},
        ${input.source ?? 'capture'}::page_source
      )
      on conflict (capture_id, page_number) do update set
        storage_key = excluded.storage_key,
        mime_type   = excluded.mime_type,
        byte_size   = excluded.byte_size,
        sha256      = excluded.sha256,
        width       = excluded.width,
        height      = excluded.height,
        source      = excluded.source
    `);
  });
}

/**
 * Result of `finalizeCapturePages`. Modelled on `updateDocument`'s
 * `{ ok: true } | { ok: false, reason }` shape elsewhere in this file, for the
 * same reason: a Postgres constraint violation is a real, anticipated outcome
 * here, not a bug, so it is a value the caller inspects — never an exception
 * that reaches an HTTP handler as an unhandled 500.
 */
export type FinalizeCapturePagesResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate'; duplicateCaptureId: string };

/**
 * Re-points a capture's page count and dedup hash at its DEMUXED pages.
 *
 * A PDF is uploaded declaring exactly one page (§4 of
 * docs/contracts/phase0-multipage.md); `createCapture` has no way to know yet
 * that it is 3 pages, so `captures.page_count` and `captures.original_sha256`
 * are provisionally wrong from the moment of upload. Once the worker has
 * demuxed the PDF and called `recordCapturePage` for every real page, this is
 * the one place that corrects both columns together — never separately, or a
 * crash between the two writes leaves a page count that does not match the
 * hash it was supposedly computed from.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED: `original_storage_key`,
 * `original_mime_type` and `original_byte_size` keep pointing at the uploaded
 * PDF. The contract is explicit that "the uploaded PDF remains the L0
 * original and is never rewritten" — page 1's RENDER is not the original, the
 * PDF file is, and `createCapture` already pointed those three columns at it
 * when the capture was first created. Moving them to a render would make the
 * ATO's "true and clear reproduction" column stop being either.
 *
 * ORDERING: `pages` must be given in PAGE ORDER — index 0 is page 1 — the
 * same convention `CreateCaptureRequest.pages` already uses; there is no
 * `pageNumber` on each entry for this function to sort by, so an out-of-order
 * array silently produces a hash for a document that does not exist. To catch
 * the one mistake that IS detectable without page numbers — finalizing before
 * every demuxed page has actually landed — the count of `pages` is checked
 * against what `capture_pages` actually holds for this capture, and a
 * mismatch throws rather than recording a page count nothing backs.
 *
 * IDEMPOTENT: re-running with the same (ordered) hashes recomputes the same
 * `captureDedupHash` and writes the same values, so a retried demux — the
 * worker crashing after this call but before acking the job, say — is a
 * no-op the second time, not a corruption. This does assume the demux itself
 * is deterministic: two renders of the same PDF must produce the same bytes,
 * or "the same document" stops meaning the same hash across retries. That
 * determinism is the demuxer's obligation (lane B), not something this
 * function can enforce.
 *
 * DUPLICATE DISCOVERED POST-DEMUX: the hash could not be known before demux,
 * so `captures_sha_unique` firing HERE means an already-distinct capture row
 * — with its own id, its own `capture_pages`, possibly its own extraction run
 * — turns out to be byte-for-byte the same document as one already on file.
 * Phase 0 does not attempt to merge two capture rows after the fact (that is
 * a multi-table decision — documents, extraction runs, review state — well
 * past what a dedup check owns). So this neither updates the row nor throws:
 * it reports `{ ok: false, reason: 'duplicate', duplicateCaptureId }` and
 * leaves both rows exactly as they were, and the caller decides the user-
 * facing outcome (most likely: quarantine this capture and point the user at
 * the existing document).
 */
export async function finalizeCapturePages(
  userId: string,
  tenantId: string,
  captureId: string,
  pages: { sha256: string }[],
): Promise<FinalizeCapturePagesResult> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const recorded = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from capture_pages where capture_id = ${captureId}
    `);
    const recordedCount = Number(recorded.rows[0]?.n ?? '0');
    if (recordedCount !== pages.length) {
      // A sequencing bug, not a business outcome: recordCapturePage must be
      // called for every demuxed page before this. Thrown hard, like the uuid
      // checks in withTenantAs, rather than folded into the result union.
      throw new Error(
        `finalizeCapturePages: capture ${captureId} has ${recordedCount} recorded page(s) ` +
          `but ${pages.length} were given — call recordCapturePage for every demuxed page first`,
      );
    }

    const dedupHash = captureDedupHash(pages);

    try {
      // A SAVEPOINT, not a bare statement: Postgres marks the WHOLE
      // transaction aborted the instant one statement violates a constraint,
      // so the follow-up SELECT below would fail with 25P02 ("current
      // transaction is aborted") on the very connection we need it to work
      // on. Nesting a drizzle `.transaction()` inside an already-open one
      // emits SAVEPOINT / ROLLBACK TO SAVEPOINT around just this statement,
      // which is what leaves the outer transaction usable afterward.
      await tx.transaction(async (tx2) => {
        await tx2.execute(sql`
          update captures
             set page_count = ${pages.length},
                 original_sha256 = decode(${dedupHash}, 'hex')
           where id = ${captureId}
        `);
      });
      return { ok: true as const };
    } catch (error) {
      // Drizzle wraps the driver error, so matching on the thrown error's own
      // message never fires — the SQLSTATE and constraint name live on
      // `.cause` (same pattern as workspaces.controller.ts's invitation dedupe).
      const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
      if (cause?.code === '23505' || cause?.constraint === 'captures_sha_unique') {
        const existing = await tx.execute<{ id: string }>(sql`
          select id from captures
           where tenant_id = ${tenantId}
             and original_sha256 = decode(${dedupHash}, 'hex')
             and id <> ${captureId}
           limit 1
        `);
        const duplicateCaptureId = existing.rows[0]?.id;
        if (!duplicateCaptureId) throw error; // constraint fired but the row it names is gone — re-throw rather than lie
        return { ok: false as const, reason: 'duplicate' as const, duplicateCaptureId };
      }
      throw error;
    }
  });
}

export type CapturePageRow = {
  page_number: number;
  storage_key: string;
  mime_type: string;
  byte_size: string;
  sha256: string;
  width: number | null;
  height: number | null;
  source: string;
  created_at: string;
};

/** A capture's pages, in page order. */
export async function listCapturePages(
  userId: string,
  tenantId: string,
  captureId: string,
): Promise<CapturePageRow[]> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<CapturePageRow>(sql`
      select page_number, storage_key, mime_type, byte_size::text as byte_size,
             encode(sha256, 'hex') as sha256, width, height,
             source::text as source, created_at::text as created_at
        from capture_pages
       where capture_id = ${captureId}
       order by page_number
    `);
    return rows.rows;
  });
}

export async function markCaptureStored(
  userId: string,
  tenantId: string,
  captureId: string,
  storageKey: string,
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    // Only the key. `capture_status` is an enum of
    // received/processing/extracted/failed/quarantined — there is no 'stored',
    // and inventing one in raw SQL failed at runtime rather than at compile
    // time. 'received' already means "we have the bytes"; the worker moves it
    // to 'extracted'.
    await tx.execute(sql`
      update captures
         set original_storage_key = ${storageKey}
       where id = ${captureId}
    `);
  });
}

/** Queues extraction. A job, not an inline call: a model takes seconds. */
export async function enqueueExtraction(
  userId: string,
  tenantId: string,
  captureId: string,
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    await tx.execute(sql`
      insert into jobs (id, tenant_id, kind, payload)
      values (${randomUUID()}, ${tenantId}, 'extract', ${JSON.stringify({ captureId })}::jsonb)
    `);
  });
}

/* ── Documents ──────────────────────────────────────────────────────────── */

export type DocumentRow = {
  id: string;
  capture_id: string;
  supplier_name: string | null;
  supplier_abn: string | null;
  supplier_abn_valid: boolean | null;
  issue_date: string | null;
  currency: string;
  tax_exclusive_amount: string | null;
  tax_amount: string | null;
  payable_amount: string | null;
  is_tax_invoice: boolean;
  doc_type: string;
  review_status: string;
  confidence_overall: string | null;
  // Narrowed to the three codes `validate()` can actually produce, rather
  // than string[]. A code the app has no wording for is a blank space on a
  // review screen, so the set is closed on purpose.
  ato_compliance: { failures?: ComplianceFailure[]; findings?: ExtractionFinding[] } | null;
  created_by: string | null;
  created_by_name: string | null;
  visibility: string;
  version: number;
  workspace_kind: string;
  tenant_id: string;
};

const DOCUMENT_COLUMNS = sql`
  d.id,
  d.capture_id,
  p.legal_name as supplier_name,
  p.abn as supplier_abn,
  p.abn_valid as supplier_abn_valid,
  d.issue_date::text as issue_date,
  d.currency::text as currency,
  d.tax_exclusive_amount::text as tax_exclusive_amount,
  d.tax_amount::text as tax_amount,
  d.payable_amount::text as payable_amount,
  d.is_tax_invoice,
  d.doc_type::text as doc_type,
  d.review_status::text as review_status,
  d.confidence_overall::text as confidence_overall,
  d.ato_compliance,
  d.created_by,
  u.display_name as created_by_name,
  d.visibility,
  d.version,
  t.kind::text as workspace_kind,
  d.tenant_id
`;

export async function listDocuments(
  userId: string,
  tenantId: string,
  filter: 'all' | 'needs_review' | 'at_risk' = 'all',
): Promise<DocumentRow[]> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<DocumentRow>(sql`
      select ${DOCUMENT_COLUMNS}
        from documents d
        join tenants t on t.id = d.tenant_id
        left join parties p on p.id = d.supplier_id
        left join users u on u.id = d.created_by
       where d.deleted_at is null
         and d.review_status <> 'rejected'
         and (${filter} = 'all'
              or (${filter} = 'needs_review' and d.review_status = 'needs_review')
              or (${filter} = 'at_risk' and d.is_tax_invoice = false))
       order by d.issue_date desc nulls last, d.created_at desc
       limit 500
    `);
    return rows.rows;
  });
}

export async function getDocument(
  userId: string,
  tenantId: string,
  documentId: string,
): Promise<{ document: DocumentRow; lines: LineRow[] } | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<DocumentRow>(sql`
      select ${DOCUMENT_COLUMNS}
        from documents d
        join tenants t on t.id = d.tenant_id
        left join parties p on p.id = d.supplier_id
        left join users u on u.id = d.created_by
       where d.id = ${documentId} and d.deleted_at is null
       limit 1
    `);
    const document = rows.rows[0];
    if (!document) return null;
    return { document, lines: await readLines(tx, documentId) };
  });
}

export type LineRow = {
  line_number: number;
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  line_net_amount: string | null;
  gst_category_code: string | null;
  line_confidence: string | null;
};

async function readLines(tx: Tx, documentId: string): Promise<LineRow[]> {
  const rows = await tx.execute<LineRow>(sql`
    select line_number, description, quantity::text as quantity,
           unit_price::text as unit_price, line_net_amount::text as line_net_amount,
           gst_category_code, line_confidence::text as line_confidence
      from document_lines
     where document_id = ${documentId}
     order by line_number
  `);
  return rows.rows;
}

/**
 * Where a capture has got to, and the document it produced.
 *
 * The client needs this because extraction is a queued job: it uploads bytes
 * and then has to ask "is it done yet". Polling the document LIST and hoping
 * the newest one is yours races every other person capturing in the same
 * workspace — which in a shared workspace is the normal case, not an edge one.
 */
export async function getCaptureProgress(
  userId: string,
  tenantId: string,
  captureId: string,
): Promise<{ status: string; documentId: string | null; error: string | null } | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<{
      status: string;
      document_id: string | null;
      error: string | null;
    }>(sql`
      select c.status::text as status,
             d.id as document_id,
             -- The most recent failure for this capture, if the worker left one.
             (select r.error from extraction_runs r
               where r.capture_id = c.id and r.error is not null
               order by r.created_at desc limit 1) as error
        from captures c
        left join documents d on d.capture_id = c.id and d.deleted_at is null
       where c.id = ${captureId}
       limit 1
    `);
    const row = rows.rows[0];
    return row
      ? { status: row.status, documentId: row.document_id, error: row.error }
      : null;
  });
}

/** The stored original behind a document, for serving the image. */
export async function getCaptureForDocument(
  userId: string,
  tenantId: string,
  documentId: string,
): Promise<{ key: string; mime: string } | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<{ key: string; mime: string }>(sql`
      select c.original_storage_key as key, c.original_mime_type as mime
        from documents d join captures c on c.id = d.capture_id
       where d.id = ${documentId} limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

/* ── Signed image reads ─────────────────────────────────────────────────── */

/**
 * The capture's original bytes, keyed by CAPTURE rather than document.
 *
 * `GET /v1/images/:token` (`docs/contracts/phase0-multipage.md` §8) has no
 * `SessionGuard` and so no user id — the signed token itself is the
 * credential, minted only ever by `toWire` for a document a caller already
 * proved membership to read. What it DOES carry is a tenant id, so this uses
 * `withTenant`, not `withTenantAs`: there is no user to check membership for,
 * only a tenant context to set before RLS decides what is visible.
 *
 * That is the property that matters here: RLS on `captures` filters by
 * `tenant_id = current_tenant_id()` before the `id` predicate is even
 * considered (migration 0010), so a token whose `captureId` names a row in a
 * DIFFERENT tenant than its own `tenantId` finds nothing — not "wrong
 * capture", nothing — the same way a query for it under `withTenant` for any
 * other tenant would. A forged or cross-tenant token is handled by the same
 * mechanism that already protects every other tenant-scoped read; it is not
 * a special case bolted on here.
 */
export async function getCaptureOriginalForImage(
  tenantId: string,
  captureId: string,
): Promise<{ key: string; mime: string } | null> {
  return withTenant(getDb(), tenantId, async (tx) => {
    const rows = await tx.execute<{ key: string; mime: string }>(sql`
      select original_storage_key as key, original_mime_type as mime
        from captures where id = ${captureId} limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

/**
 * One page's bytes, for the same signed-image route. See
 * `getCaptureOriginalForImage` for why `withTenant` (tenant-only, no
 * membership check) is correct here rather than `withTenantAs`.
 */
export async function getCapturePageForImage(
  tenantId: string,
  captureId: string,
  pageNumber: number,
): Promise<{ key: string; mime: string } | null> {
  return withTenant(getDb(), tenantId, async (tx) => {
    const rows = await tx.execute<{ key: string; mime: string }>(sql`
      select storage_key as key, mime_type as mime
        from capture_pages
       where capture_id = ${captureId} and page_number = ${pageNumber}
       limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

/* ── Workspace facts ────────────────────────────────────────────────────── */

export type TenantRow = {
  id: string;
  name: string;
  kind: 'business' | 'personal';
  abn: string | null;
  abn_valid: boolean | null;
  gst_registered: boolean;
  gst_basis: 'cash' | 'accrual';
  simpler_bas: boolean;
  occupation_profile_id: string | null;
  financial_year_start_month: number;
};

export async function readTenant(
  userId: string,
  tenantId: string,
): Promise<TenantRow | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<TenantRow>(sql`
      select id, name, kind, abn, abn_valid, gst_registered, gst_basis,
             simpler_bas, occupation_profile_id, financial_year_start_month
        from tenants where id = ${tenantId} limit 1
    `);
    return rows.rows[0] ?? null;
  });
}

export async function updateTenant(
  userId: string,
  tenantId: string,
  patch: {
    name?: string;
    abn?: string | null;
    gstRegistered?: boolean;
    gstBasis?: 'cash' | 'accrual';
    simplerBas?: boolean;
    occupationProfileId?: string | null;
  },
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    // COALESCE rather than a built-up SET list: every parameter is bound, the
    // statement is the same shape every time, and an absent field means "leave
    // it alone" instead of "set it to null".
    //
    // `abn` is the exception — it is deliberately nullable, so a caller must
    // be able to CLEAR it. An explicit null is passed through as a null, which
    // is why it carries its own flag rather than relying on COALESCE.
    await tx.execute(sql`
      update tenants set
        name = coalesce(${patch.name ?? null}, name),
        abn = case when ${patch.abn !== undefined} then ${patch.abn ?? null}::char(11) else abn end,
        gst_registered = coalesce(${patch.gstRegistered ?? null}, gst_registered),
        gst_basis = coalesce(${patch.gstBasis ?? null}::gst_basis, gst_basis),
        simpler_bas = coalesce(${patch.simplerBas ?? null}, simpler_bas),
        occupation_profile_id = case when ${patch.occupationProfileId !== undefined}
          then ${patch.occupationProfileId ?? null} else occupation_profile_id end
      where id = ${tenantId}
    `);
  });
}

export type PlanRow = {
  plan_code: string;
  plan_name: string;
  price_cents: number;
  realtime: boolean;
  scan_quota: number | null;
  seat_limit: number;
  retention_months: number;
  period_ends: string;
  features: Record<string, unknown>;
  scans_used: number;
  topup_remaining: number;
  seats_used: number;
  firm_name: string | null;
};

/**
 * What this workspace is entitled to, and how much of it is left.
 *
 * One query, because every part of it has to agree: a seat count read a moment
 * after the limit can report 6 of 5. Defaults are the free tier rather than
 * nothing — a workspace with no subscription row is a real state (it has just
 * been created), and it still has to be told what it may do.
 */
export async function readPlan(userId: string, tenantId: string): Promise<PlanRow> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<PlanRow>(sql`
      select
        coalesce(p.code, 'free')            as plan_code,
        coalesce(p.name, 'Free')            as plan_name,
        coalesce(p.price_cents, 0)          as price_cents,
        coalesce(p.realtime, false)         as realtime,
        p.scan_quota                        as scan_quota,
        coalesce(p.seat_limit, 1)           as seat_limit,
        coalesce(p.retention_months, 60)    as retention_months,
        coalesce(s.current_period_end, date_trunc('month', now()) + interval '1 month')::text
                                            as period_ends,
        coalesce(p.features, '{}'::jsonb)   as features,
        -- Scans are counted for the CURRENT month only; a quota that never
        -- resets is a quota nobody can spend twice.
        coalesce((select uc.used from usage_counters uc
                   where uc.tenant_id = ${tenantId}
                     and uc.metric = 'scans'
                     and uc.period_start = date_trunc('month', now())::date), 0) as scans_used,
        coalesce((select sum(g.remaining)::int from usage_grants g
                   where g.tenant_id = ${tenantId} and g.metric = 'scans'
                     and g.remaining > 0
                     and (g.expires_at is null or g.expires_at > now())), 0) as topup_remaining,
        (select count(*)::int from memberships m where m.tenant_id = ${tenantId}) as seats_used,
        f.name as firm_name
      from tenants t
      left join subscriptions s
        on s.tenant_id = t.id and s.status in ('active', 'trialing')
      left join plans p on p.id = s.plan_id
      left join firms f on f.id = s.firm_id
      where t.id = ${tenantId}
      order by p.seat_limit desc nulls last
      limit 1
    `);
    const row = rows.rows[0];
    if (row) return row;
    // No tenant row visible is not possible here — withTenantAs already proved
    // membership — but the type must not depend on that being true forever.
    return {
      plan_code: 'free', plan_name: 'Free', price_cents: 0, realtime: false,
      scan_quota: null, seat_limit: 1, retention_months: 60,
      period_ends: new Date().toISOString().slice(0, 10), features: {},
      scans_used: 0, topup_remaining: 0, seats_used: 1, firm_name: null,
    };
  });
}

/* ── Writes from review ─────────────────────────────────────────────────── */

/**
 * Applies a human's corrections.
 *
 * `expectedVersion` implements optimistic concurrency against the `version`
 * column and its trigger (migration 0012). Two people correcting the same
 * extraction with last-writer-wins silently loses one of them, and these are
 * money fields — so a stale write is refused and the caller re-reads.
 */
export async function updateDocument(
  userId: string,
  tenantId: string,
  documentId: string,
  patch: {
    supplierName?: string;
    supplierAbn?: string | null;
    issueDate?: string;
    payableAmount?: string;
    taxAmount?: string;
    taxExclusiveAmount?: string;
    isTaxInvoice?: boolean;
    reviewStatus?: 'needs_review' | 'reviewed' | 'rejected';
    visibility?: 'shared' | 'private';
    atoCompliance?: unknown;
  },
  expectedVersion?: number,
): Promise<{ ok: true; version: number } | { ok: false; reason: 'conflict' | 'missing' }> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const current = await tx.execute<{ version: number; supplier_id: string | null }>(sql`
      select version, supplier_id from documents where id = ${documentId} limit 1
    `);
    const row = current.rows[0];
    if (!row) return { ok: false as const, reason: 'missing' as const };
    if (expectedVersion != null && row.version !== expectedVersion) {
      return { ok: false as const, reason: 'conflict' as const };
    }

    // The supplier lives in `parties`, so a name or ABN correction updates the
    // party rather than the document. Matching on the normalised name is what
    // stops "BP Truckstop" and "BP TRUCKSTOP " becoming two suppliers.
    if (patch.supplierName != null || patch.supplierAbn !== undefined) {
      const name = patch.supplierName ?? 'Unknown supplier';
      const normalised = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const abn = patch.supplierAbn === undefined ? null : patch.supplierAbn;
      const party = await tx.execute<{ id: string }>(sql`
        insert into parties (id, tenant_id, legal_name, name_normalised, abn, kind)
        values (${randomUUID()}, ${tenantId}, ${name}, ${normalised}, ${abn}, 'supplier')
        on conflict (tenant_id, name_normalised, kind)
          do update set legal_name = excluded.legal_name,
                        abn = coalesce(excluded.abn, parties.abn)
        returning id
      `);
      const supplierId = party.rows[0]?.id ?? row.supplier_id;
      await tx.execute(sql`update documents set supplier_id = ${supplierId} where id = ${documentId}`);
    }

    /*
     * Which fields this edit settles.
     *
     * `locked_fields` had a trigger enforcing it since migration 0009 and
     * nothing that ever wrote to it, so guarantee 2 — "a human edit outranks
     * any later machine run" — was protecting an always-empty set. A
     * re-extraction would have cheerfully overwritten every correction a person
     * had made, which is the exact data the review screen exists to produce.
     *
     * Paths match `docs/extraction-schema.json`, because that is what the
     * re-extraction merge in `saveExtraction` compares against.
     */
    const touched: string[] = [];
    if (patch.issueDate != null) touched.push('header.issue_date');
    if (patch.payableAmount != null) touched.push('header.payable_amount');
    if (patch.taxAmount != null) touched.push('header.tax_amount');
    if (patch.taxExclusiveAmount != null) touched.push('header.tax_exclusive_amount');
    if (patch.supplierName != null || patch.supplierAbn !== undefined) {
      touched.push('header.supplier');
    }

    const next = await tx.execute<{ version: number }>(sql`
      update documents set
        -- Union, never replacement: locks accumulate, and the trigger rejects
        -- any attempt to shed one without a human review behind it.
        locked_fields        = (
          select coalesce(array_agg(distinct f), '{}')
            from unnest(locked_fields || ${
              touched.length > 0
                ? sql`array[${sql.join(touched.map((t) => sql`${t}`), sql`, `)}]::text[]`
                : sql`'{}'::text[]`
            }) as f
        ),
        issue_date           = coalesce(${patch.issueDate ?? null}::date, issue_date),
        payable_amount       = coalesce(${patch.payableAmount ?? null}::money_amount, payable_amount),
        tax_amount           = coalesce(${patch.taxAmount ?? null}::money_amount, tax_amount),
        tax_exclusive_amount = coalesce(${patch.taxExclusiveAmount ?? null}::money_amount, tax_exclusive_amount),
        is_tax_invoice       = coalesce(${patch.isTaxInvoice ?? null}::boolean, is_tax_invoice),
        review_status        = coalesce(${patch.reviewStatus ?? null}::review_status, review_status),
        visibility           = coalesce(${patch.visibility ?? null}, visibility),
        ato_compliance       = coalesce(${patch.atoCompliance == null ? null : JSON.stringify(patch.atoCompliance)}::jsonb, ato_compliance),
        reviewed_by          = case when ${patch.reviewStatus ?? null} = 'reviewed' then ${userId}::uuid else reviewed_by end,
        reviewed_at          = case when ${patch.reviewStatus ?? null} = 'reviewed' then now() else reviewed_at end,
        confirmed_by         = case when ${patch.reviewStatus ?? null} = 'reviewed' then ${userId}::uuid else confirmed_by end,
        confirmed_at         = case when ${patch.reviewStatus ?? null} = 'reviewed' then now() else confirmed_at end,
        updated_at           = now()
      where id = ${documentId}
      returning version
    `);
    return { ok: true as const, version: next.rows[0]?.version ?? row.version + 1 };
  });
}

/** Replaces a document's lines as a set. They only mean anything together. */
export async function replaceLines(
  userId: string,
  tenantId: string,
  documentId: string,
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    amount: string;
    gstFree: boolean;
  }>,
): Promise<void> {
  await withTenantAs(getDb(), userId, tenantId, async (tx) => {
    await tx.execute(sql`delete from document_lines where document_id = ${documentId}`);
    let n = 0;
    for (const line of lines) {
      n += 1;
      await tx.execute(sql`
        insert into document_lines (
          id, tenant_id, document_id, line_number, description, quantity,
          unit_price, line_net_amount, gst_category_code, line_confidence
        ) values (
          ${randomUUID()}, ${tenantId}, ${documentId}, ${n}, ${line.description},
          ${line.quantity}, ${line.unitPrice}, ${line.amount},
          ${line.gstFree ? 'Z' : 'S'}, 1
        )
      `);
    }
  });
}

/* ── What the worker writes ─────────────────────────────────────────────── */

/**
 * Which `extraction_engine` a model belongs to.
 *
 * The enum is claude_vision | claude_text | ocr_llm | manual | import. A
 * rented open-weights vision model is `ocr_llm`; Claude on Bedrock will be
 * `claude_vision`. Derived rather than hardcoded so the run history stays
 * honest when the provider changes — the whole point of recording the run is
 * being able to ask later what read this document.
 */
function engineFor(model: string): 'claude_vision' | 'ocr_llm' {
  return /claude/i.test(model) ? 'claude_vision' : 'ocr_llm';
}

/**
 * Records a completed extraction: the run, the supplier, the document, its
 * lines — in one transaction.
 *
 * All or nothing on purpose. A document without its lines, or a document whose
 * run was never recorded, is a row nobody can explain later; and the run is
 * what makes the extraction replayable against a better model.
 */
export async function saveExtraction(
  workerUserId: string,
  tenantId: string,
  captureId: string,
  result: ValidatedExtraction,
  meta: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    raw: string;
  },
): Promise<{ documentId: string }> {
  return withTenantAs(getDb(), workerUserId, tenantId, async (tx) => {
    const e = result.extraction;

    const runId = randomUUID();
    await tx.execute(sql`
      insert into extraction_runs (
        id, tenant_id, capture_id, engine, model_id, prompt_version, schema_version,
        tier, status, started_at, finished_at, latency_ms, input_tokens, output_tokens,
        raw_response
      ) values (
        ${runId}, ${tenantId}, ${captureId}, ${engineFor(meta.model)}, ${meta.model}, ${meta.promptVersion},
        ${e.schemaVersion}, 1, 'succeeded', now(), now(), ${meta.latencyMs},
        ${meta.inputTokens}, ${meta.outputTokens}, ${JSON.stringify({ raw: meta.raw })}::jsonb
      )
    `);

    // The supplier is a party. Deduplicated on the normalised name so a
    // hundred fuel dockets do not become a hundred suppliers.
    let supplierId: string | null = null;
    if (e.supplierName.value) {
      const normalised = e.supplierName.value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const party = await tx.execute<{ id: string }>(sql`
        insert into parties (id, tenant_id, legal_name, name_normalised, abn, kind)
        values (${randomUUID()}, ${tenantId}, ${e.supplierName.value}, ${normalised},
                ${e.supplierAbn.value}, 'supplier')
        on conflict (tenant_id, name_normalised, kind)
          do update set abn = coalesce(excluded.abn, parties.abn)
        returning id
      `);
      supplierId = party.rows[0]?.id ?? null;
    }

    /*
     * A capture may already have a document: this is a RE-EXTRACTION.
     *
     * The old code inserted with `on conflict (capture_id) do nothing`, then
     * inserted lines against a `documentId` generated locally — an id the
     * conflict clause had just declined to persist. The lines hit a foreign key
     * that did not exist and the run rolled back, which made re-extraction a
     * first-run-only operation and quietly broke `PLAN.md`'s second principle:
     * extraction is a versioned, replayable function of the image, so a better
     * model in six months is a re-run over history rather than a migration.
     *
     * Migration 0009 says what a re-run may do. This is where that is
     * implemented rather than merely asserted:
     *
     *   - A human's locked fields are NOT overwritten. Where a new run
     *     disagrees with one, it raises a review task and leaves the value.
     *   - A document behind a POSTED transaction is not rewritten at all. The
     *     books do not move because a model changed its mind; a person is asked.
     */
    const prior = await tx.execute<{
      id: string;
      locked_fields: string[] | null;
      issue_date: string | null;
      payable_amount: string | null;
      tax_amount: string | null;
      posted: boolean;
    }>(sql`
      select d.id, d.locked_fields, d.issue_date::text, d.payable_amount::text,
             d.tax_amount::text,
             exists (
               select 1 from transactions t
                where t.document_id = d.id and t.status = 'posted'
             ) as posted
        from documents d
       where d.capture_id = ${captureId}
       limit 1
    `);
    const before = prior.rows[0];

    if (before?.posted) {
      // The run is still recorded — it is evidence, and discarding it loses the
      // very comparison a reviewer needs — but nothing else moves.
      await tx.execute(sql`
        insert into review_tasks (id, tenant_id, document_id, reason, detail, priority)
        values (
          ${randomUUID()}, ${tenantId}, ${before.id}, 'reextraction_after_posting',
          ${JSON.stringify({
            runId,
            model: meta.model,
            promptVersion: meta.promptVersion,
            note: 'A newer extraction exists for a document whose transaction is posted. Nothing was changed.',
          })}::jsonb,
          2
        )
      `);
      return { documentId: before.id };
    }

    const locked = new Set(before?.locked_fields ?? []);

    // What a re-run WOULD change on a field a human already settled. Reported,
    // never applied — the point of a lock is that the machine loses.
    const contested: Array<{ field: string; kept: string | null; proposed: string | null }> = [];
    const contest = (field: string, kept: string | null, proposed: string | null) => {
      if (locked.has(field) && (kept ?? null) !== (proposed ?? null)) {
        contested.push({ field, kept: kept ?? null, proposed: proposed ?? null });
      }
    };
    if (before) {
      contest('header.issue_date', before.issue_date, e.issueDate.value);
      contest('header.payable_amount', before.payable_amount, e.payableAmount.value);
      contest('header.tax_amount', before.tax_amount, e.taxAmount.value);
    }

    /** A locked column keeps its own value; an unlocked one takes the new run's. */
    const keep = (field: string, proposed: string | null, column: string) =>
      locked.has(field) ? sql.raw(column) : sql`${proposed}`;

    let documentId: string;
    if (before) {
      documentId = before.id;
      // `locked_fields` is deliberately absent from this UPDATE. The trigger in
      // migration 0009 fires on `UPDATE OF locked_fields`, and a machine run has
      // no business touching it at all.
      await tx.execute(sql`
        update documents set
          current_run_id       = ${runId},
          doc_type             = ${result.isTaxInvoice ? 'tax_invoice' : 'receipt'},
          is_tax_invoice       = ${result.isTaxInvoice},
          ato_compliance       = ${JSON.stringify({
            failures: result.complianceFailures,
            findings: result.findings,
          })}::jsonb,
          document_number      = ${e.documentNumber.value},
          issue_date           = ${keep('header.issue_date', e.issueDate.value, 'issue_date')}::date,
          currency             = ${(e.currency.value ?? 'AUD').toUpperCase()},
          supplier_id          = ${
            locked.has('header.supplier') ? sql.raw('supplier_id') : sql`${supplierId}`
          },
          tax_exclusive_amount = ${e.taxExclusiveAmount.value},
          tax_amount           = ${keep('header.tax_amount', e.taxAmount.value, 'tax_amount')},
          tax_inclusive_amount = ${keep('header.payable_amount', e.payableAmount.value, 'tax_inclusive_amount')},
          payable_amount       = ${keep('header.payable_amount', e.payableAmount.value, 'payable_amount')},
          review_status        = ${contested.length > 0 ? 'needs_review' : result.reviewStatus},
          confidence_overall   = ${result.confidenceOverall},
          updated_at           = now()
        where id = ${documentId}
      `);

      for (const c of contested) {
        await tx.execute(sql`
          insert into review_tasks (id, tenant_id, document_id, reason, detail, priority)
          values (
            ${randomUUID()}, ${tenantId}, ${documentId}, 'reextraction_disagrees_with_human',
            ${JSON.stringify({ runId, model: meta.model, ...c })}::jsonb, 3
          )
        `);
      }

      // Lines are replaced as a set, exactly as `replaceLines` does: they only
      // mean anything together, and overlaying a new reading onto an old one is
      // not a document anybody can audit.
      await tx.execute(sql`delete from document_lines where document_id = ${documentId}`);
    } else {
      documentId = randomUUID();
      await tx.execute(sql`
        insert into documents (
          id, tenant_id, capture_id, current_run_id, doc_type, is_tax_invoice,
          ato_compliance, document_number, issue_date, currency, supplier_id,
          tax_exclusive_amount, tax_amount, tax_inclusive_amount, payable_amount,
          review_status, confidence_overall, created_by, retention_until
        ) values (
          ${documentId}, ${tenantId}, ${captureId}, ${runId},
          ${result.isTaxInvoice ? 'tax_invoice' : 'receipt'}, ${result.isTaxInvoice},
          ${JSON.stringify({ failures: result.complianceFailures, findings: result.findings })}::jsonb,
          ${e.documentNumber.value}, ${e.issueDate.value}::date,
          ${(e.currency.value ?? 'AUD').toUpperCase()}, ${supplierId},
          ${e.taxExclusiveAmount.value}, ${e.taxAmount.value},
          ${e.payableAmount.value}, ${e.payableAmount.value},
          ${result.reviewStatus}, ${result.confidenceOverall}, ${workerUserId},
          -- Five years from the issue date: the ATO's retention period, computed
          -- now so a purge job never has to guess.
          (${e.issueDate.value}::date + interval '5 years')::date
        )
      `);
    }

    let n = 0;
    for (const line of e.lines) {
      if (line.amount.value == null) continue;
      n += 1;
      await tx.execute(sql`
        insert into document_lines (
          id, tenant_id, document_id, line_number, description, quantity,
          unit_price, line_net_amount, gst_category_code, line_confidence
        ) values (
          ${randomUUID()}, ${tenantId}, ${documentId}, ${n},
          ${line.description.value ?? 'Item'}, ${line.quantity.value ?? 1},
          ${line.unitPrice.value ?? line.amount.value}, ${line.amount.value},
          ${line.gstFree.value === true ? 'Z' : 'S'}, ${line.amount.confidence}
        )
      `);
    }

    await tx.execute(sql`update captures set status = 'extracted' where id = ${captureId}`);
    return { documentId };
  });
}

/** Records why an extraction failed, so a retry has something to read. */
export async function saveExtractionFailure(
  workerUserId: string,
  tenantId: string,
  captureId: string,
  stage: string,
  error: string,
  model: string,
): Promise<void> {
  await withTenantAs(getDb(), workerUserId, tenantId, async (tx) => {
    await tx.execute(sql`
      insert into extraction_runs (
        id, tenant_id, capture_id, engine, model_id, prompt_version, schema_version,
        tier, status, error, started_at, finished_at
      ) values (
        ${randomUUID()}, ${tenantId}, ${captureId}, ${engineFor(model)}, ${model}, 'n/a', '1',
        1, 'failed', ${`${stage}: ${error}`.slice(0, 2000)}, now(), now()
      )
    `);
  });
}

/* ── DocDOM layouts, shadow stage (0019) ───────────────────────────────────
 *
 * `docs/contracts/phase1b-shadow-stage.md` §2. The DocDOM JSON itself lives
 * in object storage (lane I writes it); this is only the pointer + index
 * (`docs/OCR.md` §5.7), and it goes through `withTenantAs` like every other
 * tenant write — the worker is an ordinary app_rw member on this table
 * (migration 0019), same as `capture_pages` (0018): no elevated policy, no
 * bypass.
 */

export type LayoutRow = {
  id: string;
  captureId: string;
  extractionRunId: string | null;
  storageKey: string;
  docdomVersion: string;
  pageCount: number;
  engineIds: string[];
  spanCount: number;
  unreadableCount: number;
  shadow: boolean;
  createdAt: string;
};

type LayoutSqlRow = {
  id: string;
  capture_id: string;
  extraction_run_id: string | null;
  storage_key: string;
  docdom_version: string;
  page_count: number;
  engine_ids: string[];
  span_count: number;
  unreadable_count: number;
  shadow: boolean;
  created_at: string;
};

function toLayoutRow(row: LayoutSqlRow): LayoutRow {
  return {
    id: row.id,
    captureId: row.capture_id,
    extractionRunId: row.extraction_run_id,
    storageKey: row.storage_key,
    docdomVersion: row.docdom_version,
    pageCount: row.page_count,
    engineIds: row.engine_ids,
    spanCount: row.span_count,
    unreadableCount: row.unreadable_count,
    shadow: row.shadow,
    createdAt: row.created_at,
  };
}

/**
 * Records one DocDOM layout run against a capture.
 *
 * No uniqueness on capture_id: several layouts per capture are expected — a
 * re-run produces another, and keeping both is the same replayability
 * argument `extraction_runs` already makes (migration 0019's comment). Callers
 * that want "the current one" use `latestLayout`, not an assumption that this
 * is the only row.
 */
export async function saveLayout(
  userId: string,
  tenantId: string,
  input: {
    captureId: string;
    extractionRunId: string | null;
    storageKey: string;
    docdomVersion: string;
    pageCount: number;
    engineIds: string[];
    spanCount: number;
    unreadableCount: number;
    shadow: boolean;
  },
): Promise<{ layoutId: string }> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const id = randomUUID();
    // A bare `${array}` splices as a Postgres ROW literal, not an array
    // literal (drizzle's sql tag treats a JS array as a tuple of params) —
    // the same reason updateDocument builds `locked_fields` with
    // `array[...]::text[]` above rather than binding the array directly.
    const engineIdsLiteral =
      input.engineIds.length > 0
        ? sql`array[${sql.join(input.engineIds.map((e) => sql`${e}`), sql`, `)}]::text[]`
        : sql`'{}'::text[]`;
    await tx.execute(sql`
      insert into document_layouts (
        id, tenant_id, capture_id, extraction_run_id, storage_key, docdom_version,
        page_count, engine_ids, span_count, unreadable_count, shadow
      ) values (
        ${id}, ${tenantId}, ${input.captureId}, ${input.extractionRunId}, ${input.storageKey},
        ${input.docdomVersion}, ${input.pageCount}, ${engineIdsLiteral}, ${input.spanCount},
        ${input.unreadableCount}, ${input.shadow}
      )
    `);
    return { layoutId: id };
  });
}

/** The most recent layout for a capture, or null if none has run yet. */
export async function latestLayout(
  userId: string,
  tenantId: string,
  captureId: string,
): Promise<LayoutRow | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<LayoutSqlRow>(sql`
      select id, capture_id, extraction_run_id, storage_key, docdom_version,
             page_count, engine_ids, span_count, unreadable_count, shadow,
             created_at::text as created_at
        from document_layouts
       where capture_id = ${captureId}
       order by created_at desc
       limit 1
    `);
    const row = rows.rows[0];
    return row ? toLayoutRow(row) : null;
  });
}

/* ── Field grounding, shadow stage (0020) ──────────────────────────────────
 *
 * `docs/contracts/phase1c-grounding.md` §2. Grounding rows carry per-tenant
 * document content, not a queue, and go through `withTenantAs` like every
 * other tenant table — the worker is an ordinary app_rw member here (migration
 * 0020), same as `capture_pages` (0018) and `document_layouts` (0019): no
 * elevated policy, no bypass.
 */

export type GroundingRow = {
  id: string;
  captureId: string;
  layoutId: string;
  fieldPath: string;
  value: string;
  grounded: boolean;
  spanIds: string[];
  box: unknown | null;
  page: number | null;
  /** Weakest supporting span's confidence, as text — see money.ts's rationale
   *  for never letting NUMERIC round-trip through a JS float. */
  confidence: string;
  enforced: boolean;
  createdAt: string;
};

type GroundingSqlRow = {
  id: string;
  capture_id: string;
  layout_id: string;
  field_path: string;
  value: string;
  grounded: boolean;
  span_ids: string[];
  box: unknown | null;
  page: number | null;
  confidence: string;
  enforced: boolean;
  created_at: string;
};

function toGroundingRow(row: GroundingSqlRow): GroundingRow {
  return {
    id: row.id,
    captureId: row.capture_id,
    layoutId: row.layout_id,
    fieldPath: row.field_path,
    value: row.value,
    grounded: row.grounded,
    spanIds: row.span_ids,
    box: row.box,
    page: row.page,
    confidence: row.confidence,
    enforced: row.enforced,
    createdAt: row.created_at,
  };
}

/**
 * Persists one layout's grounding results as a set.
 *
 * Write-as-a-set, exactly the argument `replaceLines` already makes for
 * `document_lines`: a grounding result only means anything alongside its
 * siblings from the same run, and `UNIQUE (layout_id, field_path)` (migration
 * 0020) means a second call for a layout already graded is a REGROUND, not an
 * accumulation. So this deletes the layout(s) named in `rows` first, then
 * inserts the given set, inside one transaction — an upsert would leave stale
 * fields behind if a re-run produced fewer of them than the last one did.
 *
 * `rows` is typed to allow more than one layout per call, but the worker
 * (lane K) calls this once per layout with its handful of header fields —
 * multi-layout support here is just not assuming a shape the type doesn't
 * promise.
 */
export async function saveFieldGrounding(
  userId: string,
  tenantId: string,
  rows: Array<{
    captureId: string;
    layoutId: string;
    fieldPath: string;
    value: string;
    grounded: boolean;
    spanIds: string[];
    box: unknown | null;
    page: number | null;
    confidence: number;
  }>,
): Promise<{ saved: number }> {
  if (rows.length === 0) return { saved: 0 };

  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const layoutIds = [...new Set(rows.map((r) => r.layoutId))];
    const layoutIdsLiteral = sql`array[${sql.join(
      layoutIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`;
    await tx.execute(sql`
      delete from document_field_grounding where layout_id = any(${layoutIdsLiteral})
    `);

    for (const row of rows) {
      // A bare `${row.spanIds}` splices as a ROW literal rather than an array
      // literal (drizzle's sql tag treats a JS array as a tuple of params) —
      // the same reason `saveLayout` builds `engine_ids` with
      // `array[...]::text[]` rather than binding the array directly.
      const spanIdsLiteral =
        row.spanIds.length > 0
          ? sql`array[${sql.join(row.spanIds.map((s) => sql`${s}`), sql`, `)}]::text[]`
          : sql`'{}'::text[]`;
      await tx.execute(sql`
        insert into document_field_grounding (
          id, tenant_id, capture_id, layout_id, field_path, value, grounded,
          span_ids, box, page, confidence
        ) values (
          ${randomUUID()}, ${tenantId}, ${row.captureId}, ${row.layoutId}, ${row.fieldPath},
          ${row.value}, ${row.grounded}, ${spanIdsLiteral},
          ${row.box == null ? null : JSON.stringify(row.box)}::jsonb, ${row.page}, ${row.confidence}
        )
      `);
    }
    return { saved: rows.length };
  });
}

/** Every field grounded for one layout, in no particular order. */
export async function groundingForLayout(
  userId: string,
  tenantId: string,
  layoutId: string,
): Promise<GroundingRow[]> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<GroundingSqlRow>(sql`
      select id, capture_id, layout_id, field_path, value, grounded, span_ids,
             box, page, confidence::text as confidence, enforced,
             created_at::text as created_at
        from document_field_grounding
       where layout_id = ${layoutId}
    `);
    return rows.rows.map(toGroundingRow);
  });
}

/* ── Members ────────────────────────────────────────────────────────────── */

export async function listMembers(
  userId: string,
  tenantId: string,
): Promise<
  Array<{
    user_id: string;
    display_name: string | null;
    email: string | null;
    role: string;
    created_at: string;
  }>
> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<{
      user_id: string;
      display_name: string | null;
      email: string | null;
      role: string;
      created_at: string;
    }>(sql`
      select m.user_id, u.display_name, u.email, m.role, m.created_at::text as created_at
        from memberships m
        join users u on u.id = m.user_id
       -- The tenant predicate is NOT redundant with RLS here, and leaving it
       -- out was a real bug. The memberships table carries two PERMISSIVE
       -- policies: tenant isolation, OR memberships_self (migration 0012),
       -- which lets a caller read their own memberships in any tenant so the
       -- workspace switcher works before a tenant is chosen. Permissive
       -- policies are OR'd, so without this line an owner of two workspaces
       -- appeared TWICE in one workspace's member list — their row from the
       -- other workspace leaking in. RLS is a floor, not a substitute for
       -- saying what you mean.
       --
       -- (No backticks in here: this is a JS template literal, and a backtick
       -- in a SQL comment ends the string. It has bitten this file before.)
       where m.tenant_id = current_tenant_id()
       order by m.role, u.display_name
    `);
    return rows.rows;
  });
}
