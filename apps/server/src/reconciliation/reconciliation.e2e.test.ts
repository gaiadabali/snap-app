import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ID_2026 } from '@snap/tax-rules';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import { provisionTenant, sha256hex, wipeTenant } from '../test-support/tenant.js';
import { ensureDefaultFinancialAccount, createStatementFromCsv } from '../statements/statements.repo.js';
import { installRulesFor } from '../taxrules/taxrules.repo.js';

/**
 * R5c (`docs/STATEMENTS.md` §12 Lane R / §5.3.1) — candidates, and
 * accept / reject / unlink / manual link, through real HTTP against real
 * Postgres as `snap_app` — never the admin connection for anything the app
 * itself does; `admin` below is used ONLY for fixture setup and for
 * out-of-band assertions a real client could never make (reading another
 * tenant's row to prove it did NOT change).
 *
 * `matcher.test.ts` proves the fact/filter/rank logic PURELY; this file
 * proves the impure shell around it — real SQL, real RLS, a real 23505 race
 * — wires it correctly, end to end, through the registered controller.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b5c5b5c5-0000-4000-8000-000000000001';
const OWNER = 'b5c5b5c5-0000-4000-8000-0000000000a1';
const READONLY = 'b5c5b5c5-0000-4000-8000-0000000000a2';
const MEMBER = 'b5c5b5c5-0000-4000-8000-0000000000a3';

const TENANT_ID = 'b5c5b5c5-0000-4000-8000-000000000002';
const OWNER_ID = 'b5c5b5c5-0000-4000-8000-0000000000b1';

const TENANT_PERSONAL = 'b5c5b5c5-0000-4000-8000-000000000003';
const OWNER_PERSONAL = 'b5c5b5c5-0000-4000-8000-0000000000c1';

const TENANT_B = 'b5c5b5c5-0000-4000-8000-000000000004';
const OWNER_B = 'b5c5b5c5-0000-4000-8000-0000000000d1';

describeIfDb('R5c: reconciliation — candidates, accept / reject / unlink / manual link', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: typeof import('../tokens.js').issueSession;

  const auth = (userId: string, tenantId: string) => ({
    authorization: `Bearer ${issueSession(userId)}`,
    'x-workspace-id': tenantId,
  });

  beforeAll(async () => {
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'R5c test co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|r5c-owner', email: 'owner@r5c.test' },
        { id: READONLY, role: 'readonly', subject: 'test|r5c-readonly', email: 'readonly@r5c.test' },
        { id: MEMBER, role: 'member', subject: 'test|r5c-member', email: 'member@r5c.test' },
      ],
    });
    await provisionTenant({
      tenantId: TENANT_ID,
      name: 'R5c ID test co',
      users: [{ id: OWNER_ID, role: 'owner', subject: 'test|r5c-owner-id', email: 'owner-id@r5c.test' }],
    });
    await provisionTenant({
      tenantId: TENANT_PERSONAL,
      name: 'R5c personal test',
      users: [{ id: OWNER_PERSONAL, role: 'owner', subject: 'test|r5c-owner-personal', email: 'owner-personal@r5c.test' }],
      gstRegistered: false,
    });
    await provisionTenant({
      tenantId: TENANT_B,
      name: 'R5c tenant B',
      users: [{ id: OWNER_B, role: 'owner', subject: 'test|r5c-owner-b', email: 'owner-b@r5c.test' }],
    });

    await admin.query(`update tenants set country = 'ID' where id = $1`, [TENANT_ID]);
    await installRulesFor(OWNER_ID, TENANT_ID, ID_2026.id);
    await admin.query(`update tenants set kind = 'personal', abn = NULL, gst_registered = false where id = $1`, [
      TENANT_PERSONAL,
    ]);

    const tokens = await import('../tokens.js');
    issueSession = tokens.issueSession;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [OWNER, READONLY, MEMBER]);
    await wipeTenant(admin, TENANT_ID, [OWNER_ID]);
    await wipeTenant(admin, TENANT_PERSONAL, [OWNER_PERSONAL]);
    await wipeTenant(admin, TENANT_B, [OWNER_B]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  /* ── Fixture helpers ───────────────────────────────────────────────────── */

  async function makeCapture(tenantId: string): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
       values ($1, $2, $3, 'image/jpeg', 1000, decode($4, 'hex'))`,
      [id, tenantId, `test/${id}.jpg`, sha256hex()],
    );
    return id;
  }

  async function makeDocument(
    tenantId: string,
    captureId: string,
    opts: {
      payableAmount: string;
      reviewStatus?: string;
      issueDate?: string | null;
      currency?: string;
      cardBrand?: string | null;
      cardLast4?: string | null;
      docType?: string;
      isTaxInvoice?: boolean;
      taxAmount?: string | null;
    },
  ): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `insert into documents (
         id, tenant_id, capture_id, is_tax_invoice, review_status, document_number,
         issue_date, currency, card_brand, card_last4, doc_type,
         tax_exclusive_amount, tax_amount, payable_amount
       ) values ($1, $2, $3, $4, $5::review_status, $6, $7::date, $8, $9, $10, $11::doc_type, $12, $13, $14)`,
      [
        id,
        tenantId,
        captureId,
        opts.isTaxInvoice ?? true,
        opts.reviewStatus ?? 'reviewed',
        `TEST-${id.slice(0, 8)}`,
        opts.issueDate ?? null,
        opts.currency ?? 'AUD',
        opts.cardBrand ?? null,
        opts.cardLast4 ?? null,
        opts.docType ?? 'receipt',
        opts.payableAmount,
        opts.taxAmount ?? '0.0000',
        opts.payableAmount,
      ],
    );
    // Single-treatment subtotal so `loadDocumentEvidence` never falls into
    // "ambiguous_tax_categories" — every test fixture here is a plain,
    // single-tax-treatment receipt; multi-treatment reconciliation is R5b's
    // own coverage, not this file's.
    await admin.query(
      `insert into document_tax_subtotals (id, tenant_id, document_id, category_code, rate, taxable_amount, tax_amount)
       values ($1, $2, $3, 'N-T', '0.0000', $4, '0.0000')`,
      [randomUUID(), tenantId, id, opts.payableAmount],
    );
    return id;
  }

  /** One statement, N lines, via T5's own writer — never a raw INSERT. Sets
   *  `card_last4` afterward (not part of `CsvStatementLineInput`) when asked. */
  async function makeStatement(
    tenantId: string,
    ownerUserId: string,
    opts: {
      currency?: string;
      financialAccountId?: string;
      periodStart?: string;
      lines: Array<{ postedDate: string; amountSigned: string; descriptionRaw?: string; cardLast4?: string | null }>;
    },
  ): Promise<{ statementId: string; financialAccountId: string; lineIds: string[] }> {
    const captureId = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
       values ($1, $2, $3, 'text/csv', 100, decode($4, 'hex'), 'received')`,
      [captureId, tenantId, `test/${captureId}.csv`, sha256hex()],
    );
    const currency = opts.currency ?? 'AUD';
    const financialAccountId =
      opts.financialAccountId ?? (await ensureDefaultFinancialAccount(ownerUserId, tenantId, currency)).id;

    const { statementId } = await createStatementFromCsv(ownerUserId, tenantId, {
      captureId,
      financialAccountId,
      currency,
      documentRetentionYears: 5,
      periodStart: opts.periodStart ?? opts.lines[0]!.postedDate,
      periodEnd: opts.lines[opts.lines.length - 1]!.postedDate,
      openingBalance: '0.00',
      closingBalance: '0.00',
      balanceCheck: 'unverifiable',
      balanceResidual: null,
      createdBy: ownerUserId,
      fieldProvenance: { source: 'test' },
      lines: opts.lines.map((l, i) => ({
        lineNumber: i + 1,
        postedDate: l.postedDate,
        valueDate: null,
        descriptionRaw: l.descriptionRaw ?? 'Test line',
        amountSigned: l.amountSigned,
        runningBalance: null,
      })),
    });

    const rows = await admin.query<{ id: string; line_number: number }>(
      `select id, line_number from statement_lines where statement_id = $1 order by line_number`,
      [statementId],
    );
    for (let i = 0; i < opts.lines.length; i++) {
      const cardLast4 = opts.lines[i]!.cardLast4;
      if (cardLast4 !== undefined) {
        await admin.query(`update statement_lines set card_last4 = $1 where id = $2`, [
          cardLast4,
          rows.rows[i]!.id,
        ]);
      }
    }
    return { statementId, financialAccountId, lineIds: rows.rows.map((r) => r.id) };
  }

  async function candidateRow(candidateId: string): Promise<{ status: string; decided_at: string | null } | null> {
    const rows = await admin.query<{ status: string; decided_at: string | null }>(
      `select status::text as status, decided_at from match_candidates where id = $1`,
      [candidateId],
    );
    return rows.rows[0] ?? null;
  }

  async function observationsFor(transactionId: string) {
    const rows = await admin.query<{ kind: string; document_id: string | null; statement_line_id: string | null; id: string }>(
      `select id, kind::text as kind, document_id, statement_line_id from event_observations where transaction_id = $1 order by kind`,
      [transactionId],
    );
    return rows.rows;
  }

  async function transactionRow(transactionId: string) {
    const rows = await admin.query<{
      status: string;
      void_reason: string | null;
      external_refs: { superseded_by?: string };
    }>(`select status::text as status, void_reason, external_refs from transactions where id = $1`, [transactionId]);
    return rows.rows[0] ?? null;
  }

  async function splitsFor(transactionId: string) {
    const rows = await admin.query<{ account_code: string; amount: string }>(
      `select a.code as account_code, s.amount::text as amount
         from transaction_splits s join accounts a on a.id = s.account_id
        where s.transaction_id = $1
        order by s.line_number`,
      [transactionId],
    );
    return rows.rows;
  }

  /* ── Criterion 1: card-mismatch EXCLUDES (a fact); date_gap_days ranks ──── */

  it('four 12.50 lines on two cards against one 12.50 receipt: only the two on the matching card become candidates, ranked by |date_gap_days|', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, {
      payableAmount: '12.5000',
      issueDate: '2026-08-12',
      cardLast4: '4417',
    });
    const { statementId, lineIds } = await makeStatement(TENANT, OWNER, {
      lines: [
        { postedDate: '2026-08-17', amountSigned: '-12.5000', cardLast4: '9021' }, // wrong card — excluded
        { postedDate: '2026-08-14', amountSigned: '-12.5000', cardLast4: '4417' }, // right card, near
        { postedDate: '2026-08-13', amountSigned: '-12.5000', cardLast4: '9021' }, // wrong card — excluded
        { postedDate: '2026-08-19', amountSigned: '-12.5000', cardLast4: '4417' }, // right card, far
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json() as Array<{ statementLineId: string; evidence: { dateGapDays: number } }>;

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.statementLineId)).not.toContain(lineIds[0]); // wrong-card line
    expect(candidates.map((c) => c.statementLineId)).not.toContain(lineIds[2]); // wrong-card line
    // Ranked by |date_gap_days| ascending: 14 Aug (gap 2) before 19 Aug (gap 7).
    expect(candidates.map((c) => c.statementLineId)).toEqual([lineIds[1], lineIds[3]]);
    expect(candidates[0]!.evidence.dateGapDays).toBe(2);
    expect(candidates[1]!.evidence.dateGapDays).toBe(7);

    // Confirmed directly against the table too: the wrong-card pairs never
    // became a `match_candidates` row at all — EXCLUDED, not merely hidden.
    const rows = await admin.query<{ statement_line_id: string }>(
      `select statement_line_id from match_candidates where document_id = $1`,
      [documentId],
    );
    expect(rows.rows.map((r) => r.statement_line_id).sort()).toEqual([lineIds[1], lineIds[3]].sort());
    void statementId;
  });

  /* ── Criterion 2: within_posting_lag — null with no rule set, real with one ── */

  it('a tenant with no rule set installed gets within_posting_lag: null, asserted', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, {
      payableAmount: '23.0000',
      issueDate: '2026-08-01',
    });
    await makeStatement(TENANT, OWNER, {
      lines: [{ postedDate: '2026-08-03', amountSigned: '-23.0000' }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const candidates = res.json() as Array<{ evidence: Record<string, unknown> }>;
    expect(candidates).toHaveLength(1);
    expect('withinPostingLag' in candidates[0]!.evidence).toBe(true);
    expect(candidates[0]!.evidence.withinPostingLag).toBeNull();
  });

  it('an id-2026 tenant gets a real true/false label (postingLagDays 0..3)', async () => {
    const capture = await makeCapture(TENANT_ID);
    // gap 2 -> within lag
    const inLagDoc = await makeDocument(TENANT_ID, capture, {
      payableAmount: '40.0000',
      issueDate: '2026-08-01',
      currency: 'IDR',
    });
    await makeStatement(TENANT_ID, OWNER_ID, {
      currency: 'IDR',
      lines: [{ postedDate: '2026-08-03', amountSigned: '-40.0000' }],
    });
    const inLagRes = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${inLagDoc}`,
      headers: auth(OWNER_ID, TENANT_ID),
    });
    const inLag = inLagRes.json() as Array<{ evidence: { withinPostingLag: boolean | null } }>;
    expect(inLag).toHaveLength(1);
    expect(inLag[0]!.evidence.withinPostingLag).toBe(true);

    // gap 8 -> outside lag
    const capture2 = await makeCapture(TENANT_ID);
    const outOfLagDoc = await makeDocument(TENANT_ID, capture2, {
      payableAmount: '41.0000',
      issueDate: '2026-08-01',
      currency: 'IDR',
    });
    await makeStatement(TENANT_ID, OWNER_ID, {
      currency: 'IDR',
      lines: [{ postedDate: '2026-08-09', amountSigned: '-41.0000' }],
    });
    const outRes = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${outOfLagDoc}`,
      headers: auth(OWNER_ID, TENANT_ID),
    });
    const outOfLag = outRes.json() as Array<{ evidence: { withinPostingLag: boolean | null } }>;
    expect(outOfLag).toHaveLength(1);
    expect(outOfLag[0]!.evidence.withinPostingLag).toBe(false);
  });

  /* ── Criterion 3: idempotent; a rejected pair is never re-suggested ──────── */

  it('running the matcher twice adds no row for any pair, and a rejected pair is never re-suggested', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, { payableAmount: '15.0000', issueDate: '2026-08-05' });
    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-06', amountSigned: '-15.0000' }] });

    const first = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const firstIds = (first.json() as Array<{ id: string }>).map((c) => c.id);
    expect(firstIds).toHaveLength(1);

    const second = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const secondIds = (second.json() as Array<{ id: string }>).map((c) => c.id);
    expect(secondIds).toEqual(firstIds); // same row, not a duplicate

    const countRows = await admin.query<{ n: string }>(
      `select count(*) as n from match_candidates where document_id = $1`,
      [documentId],
    );
    expect(Number(countRows.rows[0]!.n)).toBe(1);

    // Reject it, then run the matcher again — it must NOT come back.
    const reject = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${firstIds[0]}/reject`,
      headers: auth(MEMBER, TENANT),
    });
    expect(reject.statusCode).toBe(200);

    const third = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}&status=suggested`,
      headers: auth(OWNER, TENANT),
    });
    expect(third.json()).toEqual([]);

    const countAfterReject = await admin.query<{ n: string }>(
      `select count(*) as n from match_candidates where document_id = $1`,
      [documentId],
    );
    expect(Number(countAfterReject.rows[0]!.n)).toBe(1); // still exactly one row — rejected, not duplicated
  });

  /* ── Criterion 4: accept supersedes and posts; needs_review is 409 ──────── */

  it('accept runs the merge and posts, returning the new transactionId', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, { payableAmount: '31.4000', issueDate: '2026-08-08' });
    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-10', amountSigned: '-31.4000' }] });

    const list = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const candidateId = (list.json() as Array<{ id: string }>)[0]!.id;

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${candidateId}/accept`,
      headers: auth(OWNER, TENANT),
      payload: {},
    });
    expect(accept.statusCode).toBe(200);
    const body = accept.json() as { transactionId: string; status: string };
    expect(body.status).toBe('posted');

    const txn = await transactionRow(body.transactionId);
    expect(txn?.status).toBe('posted');

    const row = await candidateRow(candidateId);
    expect(row?.status).toBe('accepted');
    expect(row?.decided_at).not.toBeNull();
  });

  it('accepting against a needs_review document is a 409, and nothing changes', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, {
      payableAmount: '22.0000',
      issueDate: '2026-08-09',
      reviewStatus: 'needs_review',
    });
    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-11', amountSigned: '-22.0000' }] });

    const list = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const candidateId = (list.json() as Array<{ id: string }>)[0]!.id;

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${candidateId}/accept`,
      headers: auth(OWNER, TENANT),
      payload: {},
    });
    expect(accept.statusCode).toBe(409);
    expect(JSON.stringify(accept.json())).toMatch(/not confirmed|needs review/i);

    const row = await candidateRow(candidateId);
    expect(row?.status).toBe('suggested'); // untouched by the refused accept

    const txns = await admin.query(`select id from transactions where document_id = $1`, [documentId]);
    expect(txns.rows).toHaveLength(0);
  });

  /* ── Criterion 5: concurrent accepts — exactly one wins, the other 409s ──── */

  it('two concurrent accepts for the SAME statement line: exactly one succeeds, the other gets 409, never a 500 — and the loser leaves no trace', async () => {
    const [captureA, captureB] = await Promise.all([makeCapture(TENANT), makeCapture(TENANT)]);
    const [docA, docB] = await Promise.all([
      makeDocument(TENANT, captureA, { payableAmount: '60.0000', issueDate: '2026-08-01' }),
      makeDocument(TENANT, captureB, { payableAmount: '60.0000', issueDate: '2026-08-02' }),
    ]);
    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-03', amountSigned: '-60.0000' }] });

    const listA = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${docA}`,
      headers: auth(OWNER, TENANT),
    });
    const listB = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${docB}`,
      headers: auth(OWNER, TENANT),
    });
    const candidateA = (listA.json() as Array<{ id: string }>)[0]!.id;
    const candidateB = (listB.json() as Array<{ id: string }>)[0]!.id;
    expect(candidateA).not.toBe(candidateB);

    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/reconciliation/candidates/${candidateA}/accept`,
        headers: auth(OWNER, TENANT),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/v1/reconciliation/candidates/${candidateB}/accept`,
        headers: auth(OWNER, TENANT),
        payload: {},
      }),
    ]);

    const codes = [resA.statusCode, resB.statusCode].sort();
    expect(codes).toEqual([200, 409]); // exactly one wins; the loser is a 409, never a 500

    const [winner, winnerCandidateId, loserCandidateId] =
      resA.statusCode === 200 ? [resA, candidateA, candidateB] : [resB, candidateB, candidateA];
    const winnerTxnId = (winner.json() as { transactionId: string }).transactionId;

    // The winner's transaction is untouched by the loser's failed, rolled-back
    // attempt to void it.
    const winnerTxn = await transactionRow(winnerTxnId);
    expect(winnerTxn?.status).toBe('posted');

    // The winner's candidate is decided; the LOSER's candidate is exactly
    // 'suggested' still — the failed attempt's whole transaction rolled back,
    // so it never reached the "flip to accepted" step at all.
    expect((await candidateRow(winnerCandidateId))?.status).toBe('accepted');
    expect((await candidateRow(loserCandidateId))?.status).toBe('suggested');
  });

  /* ── Criterion 6: unlink restores the pre-match state, split-for-split ──── */

  it('unlink restores the pre-match state: the receipt-only transaction is split-for-split the one that existed before the match', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, { payableAmount: '18.7500', issueDate: '2026-08-04' });

    // Receipt-first: post the document-only draft, exactly the pre-R5 road,
    // and CAPTURE its splits — this is the state unlink must restore.
    const draftRes = await app.inject({
      method: 'POST',
      url: `/v1/documents/${documentId}/transaction`,
      headers: auth(OWNER, TENANT),
    });
    expect(draftRes.statusCode).toBe(201);
    const draftTxnId = (draftRes.json() as { transactionId: string }).transactionId;
    const postRes = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${draftTxnId}/post`,
      headers: auth(OWNER, TENANT),
    });
    expect(postRes.statusCode).toBe(200);
    const preMatchSplits = await splitsFor(draftTxnId);

    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-06', amountSigned: '-18.7500' }] });
    const list = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const candidateId = (list.json() as Array<{ id: string }>)[0]!.id;

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${candidateId}/accept`,
      headers: auth(OWNER, TENANT),
      payload: {},
    });
    expect(accept.statusCode).toBe(200);
    const mergedTxnId = (accept.json() as { transactionId: string }).transactionId;
    expect(mergedTxnId).not.toBe(draftTxnId);

    const mergedObservations = await observationsFor(mergedTxnId);
    expect(mergedObservations).toHaveLength(2);
    const lineObservation = mergedObservations.find((o) => o.kind === 'statement_line')!;

    const unlink = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/observations/${lineObservation.id}/unlink`,
      headers: auth(OWNER, TENANT),
    });
    expect(unlink.statusCode).toBe(200);
    const restoredTxnId = (unlink.json() as { transactionId: string }).transactionId;
    expect(restoredTxnId).not.toBe(mergedTxnId);
    expect(restoredTxnId).not.toBe(draftTxnId); // a THIRD transaction — supersede always creates a new one

    // The merged transaction is now void, superseded by the restored one.
    const merged = await transactionRow(mergedTxnId);
    expect(merged?.status).toBe('void');
    expect(merged?.external_refs?.superseded_by).toBe(restoredTxnId);

    // Split-for-split equal to the ORIGINAL pre-match transaction.
    const restoredSplits = await splitsFor(restoredTxnId);
    expect(restoredSplits).toEqual(preMatchSplits);

    // The line has no observation and one 'unlinked' candidate; only one
    // live (non-void) transaction remains for this document.
    const candidate = await candidateRow(candidateId);
    expect(candidate?.status).toBe('unlinked');
    const restoredObservations = await observationsFor(restoredTxnId);
    expect(restoredObservations).toEqual([
      expect.objectContaining({ kind: 'document', document_id: documentId }),
    ]);
    const live = await admin.query(`select id from transactions where document_id = $1 and status <> 'void'`, [
      documentId,
    ]);
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0]!.id).toBe(restoredTxnId);
  });

  /* ── Manual link: overrides the matcher's card-mismatch exclusion ───────── */

  it('a manual link succeeds for a pair the matcher would have excluded (different cards)', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, {
      payableAmount: '9.9900',
      issueDate: '2026-08-05',
      cardLast4: '1111',
    });
    const { lineIds } = await makeStatement(TENANT, OWNER, {
      lines: [{ postedDate: '2026-08-06', amountSigned: '-9.9900', cardLast4: '2222' }],
    });

    // The matcher itself would exclude this pair — confirm it does not appear.
    const list = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    expect(list.json()).toEqual([]);

    const link = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/matches`,
      headers: auth(OWNER, TENANT),
      payload: { statementLineId: lineIds[0], documentId },
    });
    expect(link.statusCode).toBe(201);
    const body = link.json() as { transactionId: string; status: string };
    expect(body.status).toBe('posted');

    const row = await admin.query<{ status: string; proposed_by: string }>(
      `select status::text as status, proposed_by::text as proposed_by from match_candidates
        where statement_line_id = $1 and document_id = $2`,
      [lineIds[0], documentId],
    );
    expect(row.rows[0]).toMatchObject({ status: 'accepted', proposed_by: 'user' });
  });

  /* ── Criterion 7: personal workspace carries NO gst/ppn, and the check bites ── */

  describe('personal workspace: no /gst|ppn/i anywhere in the new endpoints\' responses', () => {
    it('candidates, accept, reject, manual link and unlink all stay clean', async () => {
      const capture1 = await makeCapture(TENANT_PERSONAL);
      const doc1 = await makeDocument(TENANT_PERSONAL, capture1, { payableAmount: '5.0000', issueDate: '2026-08-01' });
      const { lineIds: lines1 } = await makeStatement(TENANT_PERSONAL, OWNER_PERSONAL, {
        lines: [{ postedDate: '2026-08-02', amountSigned: '-5.0000' }],
      });

      const list = await app.inject({
        method: 'GET',
        url: `/v1/reconciliation/candidates?documentId=${doc1}`,
        headers: auth(OWNER_PERSONAL, TENANT_PERSONAL),
      });
      expect(list.statusCode).toBe(200);
      expect(JSON.stringify(list.json())).not.toMatch(/gst|ppn/i);
      const candidateId = (list.json() as Array<{ id: string }>)[0]!.id;

      const accept = await app.inject({
        method: 'POST',
        url: `/v1/reconciliation/candidates/${candidateId}/accept`,
        headers: auth(OWNER_PERSONAL, TENANT_PERSONAL),
        payload: {},
      });
      expect(accept.statusCode).toBe(200);
      expect(JSON.stringify(accept.json())).not.toMatch(/gst|ppn/i);
      const mergedTxnId = (accept.json() as { transactionId: string }).transactionId;

      // reject — a fresh, unrelated pair
      const capture2 = await makeCapture(TENANT_PERSONAL);
      const doc2 = await makeDocument(TENANT_PERSONAL, capture2, { payableAmount: '6.0000', issueDate: '2026-08-03' });
      await makeStatement(TENANT_PERSONAL, OWNER_PERSONAL, {
        lines: [{ postedDate: '2026-08-04', amountSigned: '-6.0000' }],
      });
      const list2 = await app.inject({
        method: 'GET',
        url: `/v1/reconciliation/candidates?documentId=${doc2}`,
        headers: auth(OWNER_PERSONAL, TENANT_PERSONAL),
      });
      const candidate2 = (list2.json() as Array<{ id: string }>)[0]!.id;
      const reject = await app.inject({
        method: 'POST',
        url: `/v1/reconciliation/candidates/${candidate2}/reject`,
        headers: auth(OWNER_PERSONAL, TENANT_PERSONAL),
      });
      expect(reject.statusCode).toBe(200);
      expect(JSON.stringify(reject.json())).not.toMatch(/gst|ppn/i);

      // manual link — a fresh pair, linked directly
      const capture3 = await makeCapture(TENANT_PERSONAL);
      const doc3 = await makeDocument(TENANT_PERSONAL, capture3, { payableAmount: '7.0000', issueDate: '2026-08-05' });
      const { lineIds: lines3 } = await makeStatement(TENANT_PERSONAL, OWNER_PERSONAL, {
        lines: [{ postedDate: '2026-08-06', amountSigned: '-7.0000' }],
      });
      const manual = await app.inject({
        method: 'POST',
        url: `/v1/reconciliation/matches`,
        headers: auth(OWNER_PERSONAL, TENANT_PERSONAL),
        payload: { statementLineId: lines3[0], documentId: doc3 },
      });
      expect(manual.statusCode).toBe(201);
      expect(JSON.stringify(manual.json())).not.toMatch(/gst|ppn/i);

      // unlink — undo the very first accept above
      const observations = await observationsFor(mergedTxnId);
      const lineObservation = observations.find((o) => o.kind === 'statement_line')!;
      const unlink = await app.inject({
        method: 'POST',
        url: `/v1/reconciliation/observations/${lineObservation.id}/unlink`,
        headers: auth(OWNER_PERSONAL, TENANT_PERSONAL),
      });
      expect(unlink.statusCode).toBe(200);
      expect(JSON.stringify(unlink.json())).not.toMatch(/gst|ppn/i);

      void lines1;
    });

    it('is NOT a vacuous check: the SAME assertion FAILS against a business DocumentView carrying gstAtRisk', async () => {
      // A business fixture, on the MAIN (AU, business) tenant — a receipt
      // that is not a valid tax invoice, so `gstAtRisk` is populated
      // (`documents.controller.ts`: "gstAtRisk: document.is_tax_invoice ?
      // null : (document.tax_amount ?? null)").
      const capture = await makeCapture(TENANT);
      const documentId = await makeDocument(TENANT, capture, {
        payableAmount: '44.0000',
        issueDate: '2026-08-01',
        isTaxInvoice: false,
        taxAmount: '4.0000',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/documents/${documentId}`,
        headers: auth(OWNER, TENANT),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { gstAtRisk: string | null };
      expect(body.gstAtRisk).not.toBeNull();
      // The SAME technique the personal test above relies on — proven here
      // to actually detect a real tax figure, not vacuously pass everything.
      expect(JSON.stringify(res.json())).toMatch(/gst/i);
    });
  });

  /* ── Criterion 8: another tenant gets 404 — list and accept, no row changes ── */

  it('tenant B can neither list nor accept tenant A\'s candidate — 404, and no row changes', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, { payableAmount: '77.0000', issueDate: '2026-08-01' });
    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-02', amountSigned: '-77.0000' }] });

    const list = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const candidateId = (list.json() as Array<{ id: string }>)[0]!.id;
    const before = await candidateRow(candidateId);

    const listAsB = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER_B, TENANT_B),
    });
    expect(listAsB.statusCode).toBe(404);

    const acceptAsB = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${candidateId}/accept`,
      headers: auth(OWNER_B, TENANT_B),
      payload: {},
    });
    expect(acceptAsB.statusCode).toBe(404);

    const after = await candidateRow(candidateId);
    expect(after).toEqual(before); // untouched by either cross-tenant attempt
  });

  /* ── Guards: owner/admin for accept, non-readonly for reject ─────────────── */

  it('a member (not owner/admin) is refused accept; a readonly member is refused reject', async () => {
    const capture = await makeCapture(TENANT);
    const documentId = await makeDocument(TENANT, capture, { payableAmount: '33.0000', issueDate: '2026-08-01' });
    await makeStatement(TENANT, OWNER, { lines: [{ postedDate: '2026-08-02', amountSigned: '-33.0000' }] });
    const list = await app.inject({
      method: 'GET',
      url: `/v1/reconciliation/candidates?documentId=${documentId}`,
      headers: auth(OWNER, TENANT),
    });
    const candidateId = (list.json() as Array<{ id: string }>)[0]!.id;

    const acceptAsMember = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${candidateId}/accept`,
      headers: auth(MEMBER, TENANT),
      payload: {},
    });
    expect(acceptAsMember.statusCode).toBe(409);

    const rejectAsReadonly = await app.inject({
      method: 'POST',
      url: `/v1/reconciliation/candidates/${candidateId}/reject`,
      headers: auth(READONLY, TENANT),
    });
    expect(rejectAsReadonly.statusCode).toBe(409);

    // Neither refusal touched the row.
    const row = await candidateRow(candidateId);
    expect(row?.status).toBe('suggested');
  });
});
