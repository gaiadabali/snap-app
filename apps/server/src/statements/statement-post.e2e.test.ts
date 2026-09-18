import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../db.js';
import { provisionTenant, sha256hex, wipeTenant } from '../test-support/tenant.js';
import { supersedeAndPost, draftTransactionFromDocument, postTransaction } from '../transactions/transactions.repo.js';
import {
  createStatementFromCsv,
  ensureDefaultFinancialAccount,
  postStatementLineStandalone,
  postUnmatchedStatementLines,
} from './statements.repo.js';

/**
 * R5d (`docs/STATEMENTS.md` §12 Lane R): a statement line stands alone — post
 * it as spending, singly or in bulk. Run against real Postgres as `snap_app`,
 * because the properties this proves — migration 0032's `event_observations`
 * invariants actually holding at COMMIT for a document-less merge, and the
 * SAME merge rule producing byte-identical splits regardless of arrival
 * order — cannot be proven any other way.
 *
 * D-S7 (§14.1c) retired R5d's original acceptance criterion (4), "PersonalSummary
 * is unchanged" — that assertion is not written here or anywhere in this
 * file. Under D-S7 a standalone post is a real posted transaction with a
 * real spending split, so it is expected to be visible wherever posted
 * transactions already are; "the spending view also counts unmatched lines"
 * is `M9`'s own read path (`statement_lines` minus what `event_observations`
 * already accounts for), out of this file's owned paths
 * (`apps/server/src/statements/` only) and not asserted here.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'a5d5a5d5-0000-4000-8000-000000000001';
const OWNER = 'a5d5a5d5-0000-4000-8000-0000000000a1';
const STAFF = 'a5d5a5d5-0000-4000-8000-0000000000a2';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: ReturnType<typeof sql>,
  userId: string = OWNER,
) => withTenantAs(getDb(), userId, TENANT, (tx) => tx.execute<T>(text));

async function makeCapture(admin: Client): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256, status)
     values ($1, $2, $3, 'text/csv', 100, decode($4, 'hex'), 'received')`,
    [id, TENANT, `test/${id}.csv`, sha256hex()],
  );
  return id;
}

/** One-line statement via the real T5/T2 writer — never a raw INSERT into
 *  `statement_lines`, per that file's own header comment. Returns the line id
 *  and its parent statement id (needed for the bulk endpoint). */
async function makeStatement(
  admin: Client,
  opts: {
    lines: Array<{ postedDate: string; valueDate?: string | null; amountSigned: string; description?: string }>;
    financialAccountId?: string;
  },
): Promise<{ statementId: string; lineIds: string[]; financialAccountId: string }> {
  const captureId = await makeCapture(admin);
  const financialAccountId =
    opts.financialAccountId ?? (await ensureDefaultFinancialAccount(OWNER, TENANT, 'AUD')).id;

  const closing = opts.lines[opts.lines.length - 1]!.amountSigned;
  const { statementId } = await createStatementFromCsv(OWNER, TENANT, {
    captureId,
    financialAccountId,
    currency: 'AUD',
    documentRetentionYears: 5,
    periodStart: opts.lines[0]!.postedDate,
    periodEnd: opts.lines[opts.lines.length - 1]!.postedDate,
    openingBalance: '0.00',
    closingBalance: closing,
    balanceCheck: 'pass',
    balanceResidual: null,
    createdBy: OWNER,
    fieldProvenance: { source: 'test' },
    lines: opts.lines.map((l, i) => ({
      lineNumber: i + 1,
      postedDate: l.postedDate,
      valueDate: l.valueDate ?? null,
      descriptionRaw: l.description ?? `Test line ${i + 1}`,
      amountSigned: l.amountSigned,
      runningBalance: l.amountSigned,
    })),
  });

  const rows = await admin.query<{ id: string }>(
    `select id from statement_lines where statement_id = $1 order by line_number`,
    [statementId],
  );
  return { statementId, lineIds: rows.rows.map((r) => r.id), financialAccountId };
}

interface DocSubtotal {
  categoryCode: string;
  rate: string;
  taxable: string;
  tax: string;
}

async function makeDocument(
  admin: Client,
  captureId: string,
  opts: { issueDate: string; subtotals: DocSubtotal[] },
): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into documents (
       id, tenant_id, capture_id, is_tax_invoice, review_status, document_number, issue_date, currency
     ) values ($1, $2, $3, true, 'reviewed', $4, $5::date, 'AUD')`,
    [id, TENANT, captureId, `TEST-${id.slice(0, 8)}`, opts.issueDate],
  );
  for (const s of opts.subtotals) {
    await admin.query(
      `insert into document_tax_subtotals (id, tenant_id, document_id, category_code, rate, taxable_amount, tax_amount)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), TENANT, id, s.categoryCode, s.rate, s.taxable, s.tax],
    );
  }
  return id;
}

async function splitsFor(transactionId: string) {
  const rows = await q<{ amount: string; account_code: string; tax_code: string | null; gst_amount: string; description: string | null }>(sql`
    select s.amount::text as amount, a.code as account_code, tc.code as tax_code,
           s.gst_amount::text as gst_amount, s.description
      from transaction_splits s
      join accounts a on a.id = s.account_id
      left join tax_codes tc on tc.id = s.tax_code_id
     where s.transaction_id = ${transactionId}
     order by a.code, s.amount
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
  }>(sql`
    select status::text as status, txn_date::text as txn_date, settled_date::text as settled_date,
           source::text as source, document_id
      from transactions where id = ${transactionId}
  `);
  return rows.rows[0] ?? null;
}

async function observationsFor(transactionId: string) {
  const rows = await q<{ kind: string; document_id: string | null; statement_line_id: string | null }>(sql`
    select kind::text as kind, document_id, statement_line_id from event_observations
     where transaction_id = ${transactionId}
  `);
  return rows.rows;
}

describeIfDb('R5d: a statement line stands alone — post it as spending, singly or in bulk', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'R5d test co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|r5d-owner', email: 'owner@r5d.test', displayName: 'Owner' },
        { id: STAFF, role: 'member', subject: 'test|r5d-staff', email: 'staff@r5d.test', displayName: 'Staff' },
      ],
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [OWNER, STAFF]);
    await admin.end();
    await closeDb();
  });

  it('acceptance (1a): a debit line posts as Uncategorised Purchases +amount / account -amount', async () => {
    const { lineIds } = await makeStatement(admin, {
      lines: [{ postedDate: '2026-08-14', amountSigned: '-84.2000' }],
    });

    const outcome = await postStatementLineStandalone(OWNER, TENANT, lineIds[0]!);
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    const txn = await transactionRow(outcome.transactionId);
    expect(txn).toMatchObject({
      status: 'posted',
      source: 'import',
      document_id: null,
      txn_date: '2026-08-14', // no value_date given -> falls back to posted_date
      settled_date: '2026-08-14',
    });

    const splits = await splitsFor(outcome.transactionId);
    expect(splits).toHaveLength(2);
    expect(splits).toContainEqual(
      expect.objectContaining({ account_code: '6-0000', amount: '84.2000', tax_code: null, gst_amount: '0.0000' }),
    );
    expect(splits).toContainEqual(
      expect.objectContaining({ account_code: 'BANK-IMPORT', amount: '-84.2000' }),
    );
    // Never negative spending: the debit-side split is positive.
    expect(Number(splits.find((s) => s.account_code === '6-0000')!.amount)).toBeGreaterThan(0);

    const observations = await observationsFor(outcome.transactionId);
    expect(observations).toEqual([{ kind: 'statement_line', document_id: null, statement_line_id: lineIds[0] }]);
  });

  it('acceptance (1b): a credit line posts as account +amount / Uncategorised Receipts -amount', async () => {
    const { lineIds } = await makeStatement(admin, {
      lines: [{ postedDate: '2026-08-15', amountSigned: '2500.0000' }],
    });

    const outcome = await postStatementLineStandalone(OWNER, TENANT, lineIds[0]!);
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;

    const splits = await splitsFor(outcome.transactionId);
    expect(splits).toHaveLength(2);
    expect(splits).toContainEqual(
      expect.objectContaining({ account_code: 'BANK-IMPORT', amount: '2500.0000' }),
    );
    expect(splits).toContainEqual(
      expect.objectContaining({ account_code: '4-9000', amount: '-2500.0000', tax_code: null, gst_amount: '0.0000' }),
    );
    // Money IN must never be recorded as negative spending: no split here
    // lands in an expense account.
    expect(splits.some((s) => s.account_code === '6-0000')).toBe(false);
  });

  it('posting the same line twice refuses already_observed rather than re-posting', async () => {
    const { lineIds } = await makeStatement(admin, {
      lines: [{ postedDate: '2026-08-16', amountSigned: '-12.5000' }],
    });

    const first = await postStatementLineStandalone(OWNER, TENANT, lineIds[0]!);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await postStatementLineStandalone(OWNER, TENANT, lineIds[0]!);
    expect(second).toEqual({ ok: false, reason: 'already_observed', transactionId: first.transactionId });

    // Still exactly one live transaction for this line.
    const live = await q<{ id: string }>(sql`
      select t.id from event_observations eo join transactions t on t.id = eo.transaction_id
       where eo.statement_line_id = ${lineIds[0]} and eo.kind = 'statement_line'
    `);
    expect(live.rows).toHaveLength(1);
  });

  it('acceptance (2): bulk posts every unmatched line and skips every line with a live observation, by count', async () => {
    const { statementId, lineIds } = await makeStatement(admin, {
      lines: [
        { postedDate: '2026-08-17', amountSigned: '-5.5000', description: 'Parking' },
        { postedDate: '2026-08-17', amountSigned: '-4.2000', description: 'Toll' },
        { postedDate: '2026-08-17', amountSigned: '-3.8000', description: 'Coffee' },
      ],
    });

    // One line already has a live observation before bulk runs.
    const already = await postStatementLineStandalone(OWNER, TENANT, lineIds[0]!);
    expect(already.ok).toBe(true);

    const result = await postUnmatchedStatementLines(OWNER, TENANT, statementId);
    expect(result.skipped).toBe(1);
    expect(result.posted).toHaveLength(2);

    // Every line now carries exactly one live observation — nothing was
    // silently left unposted, and the already-posted line was not touched.
    for (const lineId of lineIds) {
      const obs = await q<{ transaction_id: string }>(sql`
        select transaction_id from event_observations
         where statement_line_id = ${lineId} and kind = 'statement_line'
      `);
      expect(obs.rows).toHaveLength(1);
    }
    if (already.ok) {
      const stillSame = await q<{ transaction_id: string }>(sql`
        select transaction_id from event_observations where statement_line_id = ${lineIds[0]} and kind = 'statement_line'
      `);
      expect(stillSame.rows[0]?.transaction_id).toBe(already.transactionId);
    }

    // Running bulk again over the same statement now skips all three.
    const secondRun = await postUnmatchedStatementLines(OWNER, TENANT, statementId);
    expect(secondRun).toEqual({ posted: [], skipped: 3 });
  });

  it('acceptance (3): a later R5c accept supersedes the standalone transaction, and both arrival orders end split-for-split equal', async () => {
    const subtotals: DocSubtotal[] = [
      { categoryCode: 'S', rate: '10.0000', taxable: '68.0000', tax: '6.8000' },
      { categoryCode: 'Z', rate: '0.0000', taxable: '9.4000', tax: '0.0000' },
    ];

    // Order 1 — receipt-first: post the document-only draft, THEN match it to
    // the statement line (`supersedeAndPost`'s own document+line path, R5b).
    const captureA = await makeCapture(admin);
    const documentA = await makeDocument(admin, captureA, { issueDate: '2026-08-12', subtotals });
    const draftA = await draftTransactionFromDocument(OWNER, TENANT, documentA);
    expect(draftA.ok).toBe(true);
    if (!draftA.ok) return;
    const postedA = await postTransaction(OWNER, TENANT, draftA.transactionId);
    expect(postedA).toEqual({ ok: true });

    const { lineIds: lineIdsA } = await makeStatement(admin, {
      lines: [{ postedDate: '2026-08-14', amountSigned: '-84.2000' }],
    });
    const mergedA = await supersedeAndPost(OWNER, TENANT, { documentId: documentA, statementLineId: lineIdsA[0]! });
    expect(mergedA).toMatchObject({ ok: true });
    if (!mergedA.ok) return;

    // Order 2 — statement-first: R5d posts the line standalone FIRST, then an
    // R5c accept (`supersedeAndPost` with both sides) supersedes it.
    const { lineIds: lineIdsB } = await makeStatement(admin, {
      lines: [{ postedDate: '2026-08-14', amountSigned: '-84.2000' }],
    });
    const standaloneB = await postStatementLineStandalone(OWNER, TENANT, lineIdsB[0]!);
    expect(standaloneB.ok).toBe(true);
    if (!standaloneB.ok) return;

    const captureB = await makeCapture(admin);
    const documentB = await makeDocument(admin, captureB, { issueDate: '2026-08-12', subtotals });
    const mergedB = await supersedeAndPost(OWNER, TENANT, { documentId: documentB, statementLineId: lineIdsB[0]! });
    expect(mergedB).toMatchObject({ ok: true });
    if (!mergedB.ok) return;

    // The standalone transaction from order 2 was superseded, not left live.
    const standaloneRow = await transactionRow(standaloneB.transactionId);
    expect(standaloneRow?.status).toBe('void');
    expect(mergedB.transactionId).not.toBe(standaloneB.transactionId);

    // Both orders end with exactly one live transaction, and their splits are
    // equal set-for-set (account, amount, tax code, GST amount) — the purity
    // of `mergeObservations` showing up end to end, regardless of whether the
    // receipt or the statement line arrived, and was posted, first.
    const splitsA = (await splitsFor(mergedA.transactionId)).map((s) => ({
      account_code: s.account_code,
      amount: s.amount,
      tax_code: s.tax_code,
      gst_amount: s.gst_amount,
    }));
    const splitsB = (await splitsFor(mergedB.transactionId)).map((s) => ({
      account_code: s.account_code,
      amount: s.amount,
      tax_code: s.tax_code,
      gst_amount: s.gst_amount,
    }));
    expect(splitsB).toEqual(splitsA);

    const txnA = await transactionRow(mergedA.transactionId);
    const txnB = await transactionRow(mergedB.transactionId);
    expect(txnB).toEqual(txnA ? { ...txnA, document_id: txnB!.document_id } : null);
    expect(txnB?.status).toBe('posted');
    expect(txnB?.source).toBe('scan');
  });

  it('refuses missing_statement_line for an id that does not exist', async () => {
    const outcome = await postStatementLineStandalone(OWNER, TENANT, randomUUID());
    expect(outcome).toEqual({ ok: false, reason: 'missing_statement_line' });
  });
});
