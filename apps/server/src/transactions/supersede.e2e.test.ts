import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../db.js';
import { provisionTenant, sha256hex, wipeTenant } from '../test-support/tenant.js';
import { createStatementFromCsv, ensureDefaultFinancialAccount } from '../statements/statements.repo.js';
import { draftTransactionFromDocument, postTransaction, supersedeAndPost } from './transactions.repo.js';

/**
 * R5b, `docs/STATEMENTS.md` §5.3.1/§12 — the umbrella end-to-end, every named
 * refusal, the variance split, the Indonesian PPN case, and supersede's own
 * shape. Runs against real Postgres as `snap_app` (never a bypass role),
 * because the properties this file proves — migration 0032's deferred
 * triggers actually being satisfied at COMMIT, 0026's country trigger NOT
 * firing for a correctly-chosen tax code — cannot be proven any other way.
 *
 * `merge.test.ts` proves the merge rule's ARITHMETIC purely; this file proves
 * that the impure shell around it (`transactions.repo.ts`) wires real rows
 * through it correctly.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'f0f0f0f0-0000-4000-8000-000000000001';
const OWNER = 'f0f0f0f0-0000-4000-8000-0000000000a1';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: ReturnType<typeof sql>,
  userId: string = OWNER,
) => withTenantAs(getDb(), userId, TENANT, (tx) => tx.execute<T>(text));

async function makeCapture(admin: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
     values ($1, $2, $3, 'image/jpeg', 1000, decode($4, 'hex'))`,
    [id, tenantId, `test/${id}.jpg`, sha256hex()],
  );
  return id;
}

interface DocSubtotal {
  categoryCode: string;
  rate: string;
  taxable: string;
  tax: string;
}

async function makeDocument(
  admin: Client,
  tenantId: string,
  captureId: string,
  opts: {
    isTaxInvoice: boolean;
    reviewStatus?: string;
    issueDate?: string | null;
    currency?: string;
    cardBrand?: string | null;
    cardLast4?: string | null;
    subtotals: DocSubtotal[];
  },
): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into documents (
       id, tenant_id, capture_id, is_tax_invoice, review_status, document_number,
       issue_date, currency, card_brand, card_last4
     ) values ($1, $2, $3, $4, $5::review_status, $6, $7::date, $8, $9, $10)`,
    [
      id,
      tenantId,
      captureId,
      opts.isTaxInvoice,
      opts.reviewStatus ?? 'reviewed',
      `TEST-${id.slice(0, 8)}`,
      opts.issueDate ?? null,
      opts.currency ?? 'AUD',
      opts.cardBrand ?? null,
      opts.cardLast4 ?? null,
    ],
  );
  for (const s of opts.subtotals) {
    await admin.query(
      `insert into document_tax_subtotals (id, tenant_id, document_id, category_code, rate, taxable_amount, tax_amount)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), tenantId, id, s.categoryCode, s.rate, s.taxable, s.tax],
    );
  }
  return id;
}

/** Creates a one-line statement on a fresh financial account and returns the
 *  line's id, via the same writer T5/T2 already ship (`statements.repo.ts`),
 *  never a raw INSERT — R5b does not own that schema, only its readers. */
async function makeStatementLine(
  admin: Client,
  tenantId: string,
  opts: { postedDate: string; valueDate?: string | null; amountSigned: string; currency?: string; financialAccountId?: string },
): Promise<{ lineId: string; financialAccountId: string }> {
  const captureId = randomUUID();
  await admin.query(
    `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
     values ($1, $2, $3, 'text/csv', 100, decode($4, 'hex'), 'received')`,
    [captureId, tenantId, `test/${captureId}.csv`, sha256hex()],
  );
  const currency = opts.currency ?? 'AUD';
  const financialAccountId =
    opts.financialAccountId ?? (await ensureDefaultFinancialAccount(OWNER, tenantId, currency)).id;

  const { statementId } = await createStatementFromCsv(OWNER, tenantId, {
    captureId,
    financialAccountId,
    currency,
    documentRetentionYears: 5,
    periodStart: opts.postedDate,
    periodEnd: opts.postedDate,
    openingBalance: '0.00',
    closingBalance: opts.amountSigned,
    balanceCheck: 'pass',
    balanceResidual: null,
    createdBy: OWNER,
    fieldProvenance: { source: 'test' },
    lines: [
      {
        lineNumber: 1,
        postedDate: opts.postedDate,
        valueDate: opts.valueDate ?? null,
        descriptionRaw: 'Test line',
        amountSigned: opts.amountSigned,
        runningBalance: opts.amountSigned,
      },
    ],
  });

  const rows = await admin.query<{ id: string }>(
    `select id from statement_lines where statement_id = $1 and line_number = 1`,
    [statementId],
  );
  return { lineId: rows.rows[0]!.id, financialAccountId };
}

async function observationsFor(transactionId: string): Promise<Array<{ kind: string; document_id: string | null; statement_line_id: string | null }>> {
  const rows = await q<{ kind: string; document_id: string | null; statement_line_id: string | null }>(sql`
    select kind::text as kind, document_id, statement_line_id from event_observations
     where transaction_id = ${transactionId}
     order by kind
  `);
  return rows.rows;
}

async function transactionRow(transactionId: string) {
  const rows = await q<{
    status: string;
    txn_date: string;
    settled_date: string | null;
    source: string;
    document_id: string | null;
    void_reason: string | null;
    external_refs: { superseded_by?: string };
  }>(sql`
    select status::text as status, txn_date::text as txn_date, settled_date::text as settled_date,
           source::text as source, document_id, void_reason, external_refs
      from transactions where id = ${transactionId}
  `);
  return rows.rows[0] ?? null;
}

describeIfDb('R5b: mergeObservations wired to real Postgres — supersedeAndPost', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'R5b test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|r5b-owner', email: 'owner@r5b.test', displayName: 'Owner' }],
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    // `wipeTenant` (`test-support/tenant.ts`) already orders `transactions`
    // ahead of `event_observations` ahead of `statement_lines`/`statements` —
    // no manual pre-cleanup needed here, and doing one out of that order is
    // exactly what trips `event_observations_statement_line_id_fkey`.
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  it('the umbrella: a receipt + its statement line merge into one posted, non-void transaction with both observations', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-12',
      subtotals: [
        { categoryCode: 'S', rate: '10.0000', taxable: '68.0000', tax: '6.8000' },
        { categoryCode: 'Z', rate: '0.0000', taxable: '9.4000', tax: '0.0000' },
      ],
    });
    const { lineId } = await makeStatementLine(admin, TENANT, {
      postedDate: '2026-08-14',
      amountSigned: '-84.2000',
    });

    const outcome = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    const txn = await transactionRow(outcome.transactionId);
    expect(txn).toMatchObject({
      status: 'posted',
      txn_date: '2026-08-12',
      settled_date: '2026-08-14',
      source: 'scan',
      document_id: documentId,
    });

    const splits = await q<{ amount: string; account_code: string }>(sql`
      select s.amount::text as amount, a.code as account_code
        from transaction_splits s join accounts a on a.id = s.account_id
       where s.transaction_id = ${outcome.transactionId}
       order by s.line_number
    `);
    // Debit-side legs (68.00 S, 6.80 GST, 9.40 Z) plus the payment leg
    // (-84.20, no sign flip). Sums to zero, which is what let the post succeed
    // at all — 0006's trigger is the real proof of that, this just names them.
    const amounts = splits.rows.map((r) => Number(r.amount));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 4);
    expect(splits.rows.some((r) => r.amount === '-84.2000')).toBe(true);

    // Exactly one non-void transaction for this document.
    const live = await q<{ id: string }>(sql`
      select id from transactions where document_id = ${documentId} and status <> 'void'
    `);
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0]?.id).toBe(outcome.transactionId);

    // Both observations present.
    const observations = await observationsFor(outcome.transactionId);
    expect(observations).toHaveLength(2);
    expect(observations.find((o) => o.kind === 'document')?.document_id).toBe(documentId);
    expect(observations.find((o) => o.kind === 'statement_line')?.statement_line_id).toBe(lineId);
  });

  it('R5b closes the deploy-blocking gap: draftTransactionFromDocument now inserts its own observation, and posting no longer fails at commit', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-01',
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '50.0000', tax: '5.0000' }],
    });

    const draft = await draftTransactionFromDocument(OWNER, TENANT, documentId);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    // The exact sequence migration 0032's own test file
    // (`packages/db/test/event_observations.test.ts`) documents as "the
    // ROLLOUT-GAP case" — draft, then post — must now succeed at COMMIT.
    const posted = await postTransaction(OWNER, TENANT, draft.transactionId);
    expect(posted).toEqual({ ok: true });

    const observations = await observationsFor(draft.transactionId);
    expect(observations).toEqual([{ kind: 'document', document_id: documentId, statement_line_id: null }]);
  });

  it('refuses amount_disagreement when the receipt and the line disagree with no variance named', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-12',
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '76.5500', tax: '7.6500' }],
    });
    const { lineId } = await makeStatementLine(admin, TENANT, {
      postedDate: '2026-08-14',
      amountSigned: '-89.2000', // $5 more than the receipt — a tip, unnamed
    });

    const outcome = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
    expect(outcome).toMatchObject({ ok: false, reason: 'amount_disagreement', documentAmount: '84.2000', lineAmount: '-89.2000' });

    // Nothing was posted, nothing was voided.
    const rows = await q<{ id: string }>(sql`select id from transactions where document_id = ${documentId}`);
    expect(rows.rows).toHaveLength(0);
  });

  it('refuses currency_mismatch between the document and the matched line\'s financial account', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-12',
      currency: 'AUD',
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '76.5500', tax: '7.6500' }],
    });

    // A USD financial account — direct INSERT (not `ensureDefaultFinancialAccount`,
    // which always finds/creates the tenant's ONE placeholder and ignores the
    // currency argument on the "found" path) so this line's account genuinely
    // disagrees with the document's AUD.
    const usdLedgerAccountId = randomUUID();
    await admin.query(
      `insert into accounts (id, tenant_id, code, name, account_type) values ($1, $2, 'BANK-USD', 'USD test account', 'asset')`,
      [usdLedgerAccountId, TENANT],
    );
    const usdFinancialAccountId = randomUUID();
    await admin.query(
      `insert into financial_accounts (id, tenant_id, account_id, institution, account_type, currency)
       values ($1, $2, $3, 'Test USD Bank', 'transaction', 'USD')`,
      [usdFinancialAccountId, TENANT, usdLedgerAccountId],
    );
    const { lineId } = await makeStatementLine(admin, TENANT, {
      postedDate: '2026-08-14',
      amountSigned: '-84.2000',
      currency: 'USD',
      financialAccountId: usdFinancialAccountId,
    });

    const outcome = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
    expect(outcome).toMatchObject({ ok: false, reason: 'currency_mismatch', documentCurrency: 'AUD', lineCurrency: 'USD' });
  });

  it('refuses document_not_confirmed for a document still needing review', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-12',
      reviewStatus: 'needs_review',
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '76.5500', tax: '7.6500' }],
    });
    const { lineId } = await makeStatementLine(admin, TENANT, { postedDate: '2026-08-14', amountSigned: '-84.2000' });

    const outcome = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
    expect(outcome).toMatchObject({ ok: false, reason: 'document_not_confirmed', reviewStatus: 'needs_review' });
  });

  it('a named tip variance posts the +5.00 split and merges into one transaction', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-12',
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '76.5500', tax: '7.6500' }],
    });
    const { lineId } = await makeStatementLine(admin, TENANT, {
      postedDate: '2026-08-14',
      amountSigned: '-89.2000',
    });

    const outcome = await supersedeAndPost(OWNER, TENANT, {
      documentId,
      statementLineId: lineId,
      variance: { kind: 'tip' },
    });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    const varianceSplit = await q<{ amount: string; tax_code: string | null; description: string | null }>(sql`
      select s.amount::text as amount, tc.code as tax_code, s.description
        from transaction_splits s
        join accounts a on a.id = s.account_id
        left join tax_codes tc on tc.id = s.tax_code_id
       where s.transaction_id = ${outcome.transactionId} and a.code = '6-9200'
    `);
    expect(varianceSplit.rows).toHaveLength(1);
    expect(varianceSplit.rows[0]?.amount).toBe('5.0000');
    expect(varianceSplit.rows[0]?.tax_code).toBe('N-T');
    expect(varianceSplit.rows[0]?.description).toContain('tip');
  });

  it('an Indonesian tenant gets PPN, and 0026\'s country trigger does not fire', async () => {
    await admin.query(`update tenants set country = 'ID' where id = $1`, [TENANT]);
    try {
      const capture = await makeCapture(admin, TENANT);
      const documentId = await makeDocument(admin, TENANT, capture, {
        isTaxInvoice: true,
        issueDate: '2026-08-12',
        subtotals: [{ categoryCode: 'S', rate: '11.0000', taxable: '76.5500', tax: '7.6500' }],
      });
      const { lineId } = await makeStatementLine(admin, TENANT, {
        postedDate: '2026-08-14',
        amountSigned: '-84.2000',
      });

      const outcome = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
      // This is the write that fails today without R5b: `loadTaxCodes` was
      // already fixed to be country-scoped (333ea50), but nothing called it
      // from a real posting path with an ID tenant until this ticket wired
      // `mergeObservations`/`taxCodeFor` into `supersedeAndPost`. If the
      // country-aware fix ever regressed, this would surface as a THROWN
      // 23514 from 0026's trigger, not a clean refusal — asserted below.
      expect(outcome).toMatchObject({ ok: true });
      if (!outcome.ok) return;

      const taxSplit = await q<{ tax_code: string | null }>(sql`
        select tc.code as tax_code from transaction_splits s
          join tax_codes tc on tc.id = s.tax_code_id
         where s.transaction_id = ${outcome.transactionId} and tc.code is not null
      `);
      expect(taxSplit.rows.map((r) => r.tax_code)).toEqual(['PPN']);
      expect(taxSplit.rows.map((r) => r.tax_code)).not.toContain('GST');
    } finally {
      await admin.query(`update tenants set country = 'AU' where id = $1`, [TENANT]);
    }
  });

  it('never dates a merged transaction current_date when a statement line is present', async () => {
    const capture = await makeCapture(admin, TENANT);
    // No issue_date at all on the receipt.
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: null,
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '76.5500', tax: '7.6500' }],
    });
    const { lineId } = await makeStatementLine(admin, TENANT, {
      postedDate: '2026-08-14',
      valueDate: '2026-08-13',
      amountSigned: '-84.2000',
    });

    const outcome = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    const txn = await transactionRow(outcome.transactionId);
    // value_date, not today's real date — this test would be a false
    // positive if it ever ran to coincide with today's date, so today's date
    // is asserted OUT rather than asserted in.
    expect(txn?.txn_date).toBe('2026-08-13');
    const today = new Date().toISOString().slice(0, 10);
    expect(txn?.txn_date).not.toBe(today);
  });

  it('supersede leaves the old transaction void with superseded_by, and no dangling observation link', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      issueDate: '2026-08-12',
      subtotals: [{ categoryCode: 'S', rate: '10.0000', taxable: '76.5500', tax: '7.6500' }],
    });

    // Receipt-first (§5.3.1 Q4): post the document-only draft first, exactly
    // the pre-R5 road.
    const draft = await draftTransactionFromDocument(OWNER, TENANT, documentId);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const posted = await postTransaction(OWNER, TENANT, draft.transactionId);
    expect(posted).toEqual({ ok: true });
    const oldTransactionId = draft.transactionId;

    // The statement lands later and matches it.
    const { lineId } = await makeStatementLine(admin, TENANT, { postedDate: '2026-08-14', amountSigned: '-84.2000' });
    const merged = await supersedeAndPost(OWNER, TENANT, { documentId, statementLineId: lineId });
    expect(merged).toMatchObject({ ok: true });
    if (!merged.ok) return;
    expect(merged.transactionId).not.toBe(oldTransactionId);

    const oldTxn = await transactionRow(oldTransactionId);
    expect(oldTxn?.status).toBe('void');
    expect(oldTxn?.void_reason).toMatch(/^superseded:/);
    expect(oldTxn?.external_refs?.superseded_by).toBe(merged.transactionId);

    // No dangling link: the OLD transaction carries zero observations.
    const oldObservations = await observationsFor(oldTransactionId);
    expect(oldObservations).toHaveLength(0);

    // The NEW transaction carries both, re-pointed rather than duplicated.
    const newObservations = await observationsFor(merged.transactionId);
    expect(newObservations).toHaveLength(2);
    expect(newObservations.find((o) => o.kind === 'document')?.document_id).toBe(documentId);
    expect(newObservations.find((o) => o.kind === 'statement_line')?.statement_line_id).toBe(lineId);

    // Only one live (non-void) transaction remains for this document.
    const live = await q<{ id: string }>(sql`
      select id from transactions where document_id = ${documentId} and status <> 'void'
    `);
    expect(live.rows).toHaveLength(1);
    expect(live.rows[0]?.id).toBe(merged.transactionId);
  });
});
