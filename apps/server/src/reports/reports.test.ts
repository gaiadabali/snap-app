import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { money } from '@snap/db';

import { closeDb } from '../db.js';
import { postTransaction } from '../transactions/transactions.repo.js';
import { makeAccount, provisionTenant, sha256hex, wipeTenant } from '../test-support/tenant.js';
import { ReportsController } from './reports.controller.js';
import { basReport } from './reports.repo.js';

/**
 * BAS reporting — `docs/contracts/alpha-gaps.md` Lane M.
 *
 * Runs against real Postgres, same convention as `transactions.test.ts`:
 * only fixture setup uses the privileged `ADMIN_DATABASE_URL` connection,
 * every assertion goes through `basReport` (what the controller calls) under
 * the real `snap_app` role and RLS.
 *
 * This suite proves the exit criterion from `docs/PLAN.md` §8 in two parts
 * that must not be conflated:
 *
 *   1. On wholly claimable, wholly-taxable data, the report reconciles:
 *      `1A ≈ G1/11` and `1B ≈ (G10+G11)/11` — exactly, here, since every
 *      contributing split is a clean 10% line.
 *   2. `1B` excludes every split whose evidence document is not a valid tax
 *      invoice, no matter how that changes the ratio — proved twice: once as
 *      a delta inside the first tenant's fixture, and once in a second,
 *      wholly isolated tenant built for nothing else, so the exclusion holds
 *      even when it is the ONLY thing posted for the period (no other GST to
 *      net against). Both fixtures are this suite's own — no assertion here
 *      depends on data any other suite or process might reseed or delete.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b2b2b2b2-0000-4000-8000-000000000002';
const OWNER = 'b2b2b2b2-0000-4000-8000-0000000000b1';

// A second, wholly separate tenant for the "unclaimable GST" guarantee in
// isolation — no other GST posted in the period, so the exclusion from 1B
// cannot be masked or helped along by anything else the first tenant posted.
const UNCLAIMABLE_TENANT = 'b2b2b2b2-0000-4000-8000-000000000003';
const UNCLAIMABLE_OWNER = 'b2b2b2b2-0000-4000-8000-0000000000c1';

type TaxCodeIds = Record<'GST' | 'CAP' | 'GSTONINCOME' | 'FRE', string>;

async function loadSystemTaxCodes(admin: Client): Promise<TaxCodeIds> {
  const { rows } = await admin.query<{ code: string; id: string }>(
    `select code, id from tax_codes where tenant_id is null and code = any($1)`,
    [['GST', 'CAP', 'GSTONINCOME', 'FRE']],
  );
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.id])) as TaxCodeIds;
  for (const code of ['GST', 'CAP', 'GSTONINCOME', 'FRE'] as const) {
    if (!byCode[code]) throw new Error(`seed tax code ${code} missing — check migration 0005`);
  }
  return byCode;
}

/** A minimal capture + document, just enough for `transactions.document_id`'s FK and `is_tax_invoice`. */
async function makeDocument(
  admin: Client,
  tenantId: string,
  isTaxInvoice: boolean,
): Promise<string> {
  const captureId = randomUUID();
  await admin.query(
    `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
     values ($1, $2, $3, 'image/jpeg', 1000, decode($4, 'hex'))`,
    [captureId, tenantId, `test/${captureId}.jpg`, sha256hex()],
  );
  const documentId = randomUUID();
  await admin.query(
    `insert into documents (id, tenant_id, capture_id, is_tax_invoice, review_status)
     values ($1, $2, $3, $4, 'reviewed')`,
    [documentId, tenantId, captureId, isTaxInvoice],
  );
  return documentId;
}

/** A posted transaction with exactly one BAS-reportable split, plus its balancing legs. */
async function postPosting(
  admin: Client,
  ownerId: string,
  tenantId: string,
  txnDate: string,
  documentId: string | null,
  reportable: { accountId: string; amount: string; taxCodeId: string; gstAmount: string },
  controlAccountId: string,
  balancingAccountId: string,
): Promise<string> {
  const txnId = randomUUID();
  await admin.query(
    `insert into transactions (id, tenant_id, txn_date, status, source, document_id)
     values ($1, $2, $3, 'draft', 'manual', $4)`,
    [txnId, tenantId, txnDate, documentId],
  );
  // Exact decimal arithmetic, same helper the ledger itself uses (never a
  // JS float) — an income posting's amount is already negative, so its GST
  // control leg (also a liability) is the same negation of the GST amount;
  // an expense posting's amount is positive, and so is its asset-side GST leg.
  const net = money.money(reportable.amount);
  const isIncome = money.compare(net, money.ZERO) < 0;
  const controlAmount = isIncome ? money.negate(money.money(reportable.gstAmount)) : money.money(reportable.gstAmount);
  const balancingAmount = money.negate(money.add(net, controlAmount));
  await admin.query(
    `insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount) values
       ($1, $2, $3, 1, $4, $5, $6, $7),
       ($8, $2, $3, 2, $9, $10, null, 0),
       ($11, $2, $3, 3, $12, $13, null, 0)`,
    [
      randomUUID(),
      tenantId,
      txnId,
      reportable.accountId,
      reportable.amount,
      reportable.taxCodeId,
      reportable.gstAmount,
      randomUUID(),
      controlAccountId,
      controlAmount,
      randomUUID(),
      balancingAccountId,
      balancingAmount,
    ],
  );
  const outcome = await postTransaction(ownerId, tenantId, txnId);
  if (!outcome.ok) throw new Error(`fixture failed to post: ${JSON.stringify(outcome)}`);
  return txnId;
}

describeIfDb('reports/bas', () => {
  let admin: Client;
  let taxCodes: TaxCodeIds;
  let expenseAccount: string;
  let incomeAccount: string;
  let gstReceivable: string;
  let gstUnclaimableAccount: string;
  let gstCollected: string;
  let apAccount: string;
  let arAccount: string;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Lane M test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|reports-owner', email: 'owner@lanem.test', displayName: 'Reports Owner' }],
      gstBasis: 'accrual',
    });

    taxCodes = await loadSystemTaxCodes(admin);
    expenseAccount = await makeAccount(admin, TENANT, '6-0000', 'Purchases', 'expense');
    incomeAccount = await makeAccount(admin, TENANT, '4-0000', 'Sales', 'income');
    gstReceivable = await makeAccount(admin, TENANT, '1-2100', 'GST Receivable', 'asset');
    gstUnclaimableAccount = await makeAccount(admin, TENANT, '6-9000', 'GST Paid — Not Claimable', 'expense');
    gstCollected = await makeAccount(admin, TENANT, '2-2100', 'GST Collected', 'liability');
    apAccount = await makeAccount(admin, TENANT, '2-1000', 'Trade Creditors', 'liability');
    arAccount = await makeAccount(admin, TENANT, '1-1000', 'Trade Debtors', 'asset');

    // ── Clean period: 1-15 July — wholly taxable sale, wholly claimable purchases.
    await postPosting(
      admin,
      OWNER,
      TENANT,
      '2026-07-10',
      null,
      { accountId: incomeAccount, amount: '-1000.0000', taxCodeId: taxCodes.GSTONINCOME, gstAmount: '100.0000' },
      gstCollected,
      arAccount,
    );
    const invoiceDoc = await makeDocument(admin, TENANT, true);
    await postPosting(
      admin,
      OWNER,
      TENANT,
      '2026-07-12',
      invoiceDoc,
      { accountId: expenseAccount, amount: '1000.0000', taxCodeId: taxCodes.GST, gstAmount: '100.0000' },
      gstReceivable,
      apAccount,
    );
    const capitalDoc = await makeDocument(admin, TENANT, true);
    await postPosting(
      admin,
      OWNER,
      TENANT,
      '2026-07-14',
      capitalDoc,
      { accountId: expenseAccount, amount: '2000.0000', taxCodeId: taxCodes.CAP, gstAmount: '200.0000' },
      gstReceivable,
      apAccount,
    );

    // ── 20 July: a standard-rated purchase with NO valid tax invoice — the
    //    fixture proving the exclusion clause, independent of the real tenant.
    const noInvoiceDoc = await makeDocument(admin, TENANT, false);
    await postPosting(
      admin,
      OWNER,
      TENANT,
      '2026-07-20',
      noInvoiceDoc,
      { accountId: expenseAccount, amount: '300.0000', taxCodeId: taxCodes.GST, gstAmount: '30.0000' },
      gstUnclaimableAccount,
      apAccount,
    );
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  it('reconciles exactly over a period of wholly claimable, wholly taxable postings', async () => {
    const report = await basReport(OWNER, TENANT, '2026-07-01', '2026-07-16');

    expect(report.G1).toBe('1100.0000'); // 1000 net + 100 GST
    expect(report['1A']).toBe('100.0000');
    expect(report.G11).toBe('1100.0000'); // the standard purchase
    expect(report.G10).toBe('2200.0000'); // the capital purchase
    expect(report['1B']).toBe('300.0000'); // 100 + 200, both claimable
    expect(report.unclaimableGst).toBe('0.0000');

    // The exit criterion, docs/PLAN.md §8: 1A ~= G1/11, 1B ~= (G10+G11)/11.
    // 1100/11 = 100 exactly; 3300/11 = 300 exactly — no rounding slack needed.
    for (const check of report.reconciliation) {
      expect(check.withinTolerance).toBe(true);
    }
    expect(report.reconciliation.find((c) => c.label === '1A')?.expected).toBe('100.0000');
    expect(report.reconciliation.find((c) => c.label === '1B')?.expected).toBe('300.0000');
  });

  it('excludes a non-tax-invoice purchase from 1B while still counting its gross in G11', async () => {
    const clean = await basReport(OWNER, TENANT, '2026-07-01', '2026-07-16');
    const withUnclaimable = await basReport(OWNER, TENANT, '2026-07-01', '2026-07-31');

    // The extra purchase's $330 gross joins G11 either way — GST turnover
    // does not care whether the paperwork supports a credit.
    expect(withUnclaimable.G11).toBe('1430.0000'); // 1100 + 330
    // But its $30 of GST must NOT appear in 1B...
    expect(withUnclaimable['1B']).toBe(clean['1B']); // still 300.0000
    // ...and must not silently disappear either.
    expect(withUnclaimable.unclaimableGst).toBe('30.0000');

    // With a third of the purchase-side GST now unclaimable, 1B legitimately
    // stops tracking (G10+G11)/11 — the sanity check has teeth, and
    // `unclaimableGst` is exactly what explains the gap.
    const label1b = withUnclaimable.reconciliation.find((c) => c.label === '1B')!;
    expect(label1b.withinTolerance).toBe(false);
    expect(label1b.expected).not.toBe(label1b.reported);
  });

  it('rejects an invalid date range before touching the database', async () => {
    const controller = new ReportsController();
    await expect(
      controller.bas({ userId: OWNER } as never, TENANT, undefined, '2026-07-31'),
    ).rejects.toThrow(/from must be/);
    await expect(
      controller.bas({ userId: OWNER } as never, TENANT, '2026-07-01', 'not-a-date'),
    ).rejects.toThrow(/to must be/);
    await expect(
      controller.bas({ userId: OWNER } as never, TENANT, '2026-08-01', '2026-07-01'),
    ).rejects.toThrow(/from must not be after to/);
  });
});

describeIfDb('reports/bas — a purchase with no valid tax invoice, alone in its period', () => {
  /**
   * This used to read tenant `11111111-1111-4111-8111-111111111111`, which
   * another lane's suites also seed and re-seed — a shared read is not
   * reproducible if the thing on the other end can be deleted out from under
   * it, which is exactly what happened (`transactions`/`documents` at 0 rows
   * mid-run). The guarantee itself — 1B excludes a non-tax-invoice purchase's
   * GST no matter how that changes the ratio — is proved just as strongly by
   * a fixture this suite owns outright: one tenant, one posted purchase,
   * built specifically to have no valid tax invoice behind it.
   */
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: UNCLAIMABLE_TENANT,
      name: 'Lane M unclaimable-GST test co',
      users: [
        {
          id: UNCLAIMABLE_OWNER,
          role: 'owner',
          subject: 'test|unclaimable-owner',
          email: 'owner@lanem-unclaimable.test',
          displayName: 'Unclaimable Owner',
        },
      ],
      gstBasis: 'accrual',
    });

    const taxCodes = await loadSystemTaxCodes(admin);
    const expenseAccount = await makeAccount(admin, UNCLAIMABLE_TENANT, '6-0000', 'Purchases', 'expense');
    const unclaimableAccount = await makeAccount(
      admin,
      UNCLAIMABLE_TENANT,
      '6-9000',
      'GST Paid — Not Claimable',
      'expense',
    );
    const apAccount = await makeAccount(admin, UNCLAIMABLE_TENANT, '2-1000', 'Trade Creditors', 'liability');

    const noInvoiceDoc = await makeDocument(admin, UNCLAIMABLE_TENANT, false);
    await postPosting(
      admin,
      UNCLAIMABLE_OWNER,
      UNCLAIMABLE_TENANT,
      '2026-08-10',
      noInvoiceDoc,
      { accountId: expenseAccount, amount: '15926.6500', taxCodeId: taxCodes.GST, gstAmount: '1592.6600' },
      unclaimableAccount,
      apAccount,
    );
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, UNCLAIMABLE_TENANT, [UNCLAIMABLE_OWNER]);
    await admin.end();
    await closeDb();
  });

  it('keeps that document out of 1B and puts its GST in unclaimableGst instead', async () => {
    const report = await basReport(UNCLAIMABLE_OWNER, UNCLAIMABLE_TENANT, '2026-08-01', '2026-08-31');

    // The only posting in the period: a standard-rated purchase with no
    // valid tax invoice behind it. Its GST must not appear in 1B...
    expect(report.unclaimableGst).toBe('1592.6600');
    expect(report['1B']).toBe('0.0000');
    // ...but the gross amount still lands in G11 — it is real GST turnover,
    // just not a credit this tenant may claim.
    expect(report.G11).toBe('17519.3100'); // 15926.65 net + 1592.66 GST
  });
});
