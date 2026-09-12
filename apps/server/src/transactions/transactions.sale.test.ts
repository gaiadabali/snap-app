import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../db.js';
import { basReport } from '../reports/reports.repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import {
  draftTransactionFromInvoice,
  listTransactions,
  postTransaction,
} from './transactions.repo.js';
import { TransactionsController } from './transactions.controller.js';

/**
 * The sale side of the ledger — the mirror of `transactions.test.ts`'s
 * purchase-side proof, and built against the same real Postgres for the same
 * reason: "sum of splits is zero, or Postgres refuses the posting" and "a
 * posted sale moves the BAS" are not things a mock can exercise.
 *
 * A dedicated tenant, separate from every other suite's fixtures, so this
 * file's BAS assertions start from a known zero rather than whatever another
 * suite happened to leave posted.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b2b2b2b2-0000-4000-8000-000000000001';
const OWNER = 'b2b2b2b2-0000-4000-8000-0000000000a1';
const STAFF = 'b2b2b2b2-0000-4000-8000-0000000000a2';
const CUSTOMER = 'b2b2b2b2-0000-4000-8000-0000000000c1';

// A wide window so every fixture's `current_date` issue date falls inside it,
// without the test needing to know what "today" is.
const FROM = '2000-01-01';
const TO = '2100-01-01';

async function makeInvoice(
  admin: Client,
  opts: {
    status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void';
    net: string;
    gst: string;
    itemTaxCode?: string;
  },
): Promise<string> {
  const invoiceId = randomUUID();
  const total = (Number(opts.net) + Number(opts.gst)).toFixed(4);
  const number = `SALE-TEST-${invoiceId.slice(0, 8)}`;
  await admin.query(
    `insert into invoices (
       id, tenant_id, number, kind, status, party_id, issue_date, due_date,
       net_amount, gst_amount, total_amount
     ) values ($1, $2, $3, 'invoice', $4::invoice_status, $5, current_date, current_date + 14, $6, $7, $8)`,
    [invoiceId, TENANT, number, opts.status, CUSTOMER, opts.net, opts.gst, total],
  );

  let itemId: string | null = null;
  if (opts.itemTaxCode) {
    itemId = randomUUID();
    await admin.query(
      `insert into items (id, tenant_id, name, unit, sell_price, cost_price, tax_code)
       values ($1, $2, 'Test export service', 'ea', 0, 0, $3)`,
      [itemId, TENANT, opts.itemTaxCode],
    );
  }

  await admin.query(
    `insert into invoice_lines (
       id, tenant_id, invoice_id, line_number, item_id, description, unit,
       quantity, unit_price, net_amount, gst_amount, total_amount
     ) values ($1, $2, $3, 1, $4, 'test line', 'ea', 1, $5, $6, $7, $8)`,
    [randomUUID(), TENANT, invoiceId, itemId, opts.net, opts.net, opts.gst, total],
  );

  return invoiceId;
}

describeIfDb('transactions: draft from invoice (the sale side)', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Lane sale-side test co',
      gstBasis: 'accrual',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|sale-owner', email: 'owner@salel.test', displayName: 'Sale Owner Test' },
        { id: STAFF, role: 'member', subject: 'test|sale-staff', email: 'staff@salel.test', displayName: 'Sale Staff Test' },
      ],
    });
    await admin.query(
      `insert into parties (id, tenant_id, legal_name, name_normalised, kind)
       values ($1, $2, 'Test Customer Pty Ltd', 'test customer pty ltd', 'customer')`,
      [CUSTOMER, TENANT],
    );
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [OWNER, STAFF]);
    await admin.end();
    await closeDb();
  });

  it('drafts a balanced transaction from a sent invoice, posts it, and moves the BAS', async () => {
    const before = await basReport(OWNER, TENANT, FROM, TO);
    expect(before.G1).toBe('0.0000');
    expect(before['1A']).toBe('0.0000');

    const invoiceId = await makeInvoice(admin, { status: 'sent', net: '1000.0000', gst: '100.0000' });

    const outcome = await draftTransactionFromInvoice(OWNER, TENANT, invoiceId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [txn] = await listTransactions(OWNER, TENANT, { status: 'draft' });
    expect(txn?.id).toBe(outcome.transactionId);

    // Sign convention (`docs/PLAN.md` §5): revenue and GST payable are
    // credits (negative), the receivable is a debit (positive), sum zero —
    // the mirror of the purchase side's expense/GST-receivable/payable shape.
    const revenue = txn!.splits.find((s) => s.accountName === 'Sales Revenue');
    expect(revenue?.amount).toBe('-1000.0000');
    expect(revenue?.taxCode).toBe('GSTONINCOME');
    expect(revenue?.gstAmount).toBe('100.0000');

    const gstPayable = txn!.splits.find((s) => s.accountName === 'GST Payable');
    expect(gstPayable?.amount).toBe('-100.0000');
    expect(gstPayable?.taxCodeId).toBeNull(); // control posting, never double-counted

    const receivable = txn!.splits.find((s) => s.accountName === 'Trade Debtors');
    expect(receivable?.amount).toBe('1100.0000');

    const sum = txn!.splits.reduce((acc, s) => acc + Number(s.amount), 0);
    expect(sum).toBeCloseTo(0, 4);

    // Rule 3: an invoice that already has a live transaction may not get a
    // second one.
    const second = await draftTransactionFromInvoice(OWNER, TENANT, invoiceId);
    expect(second).toMatchObject({ ok: false, reason: 'already_posted' });

    // Rule 4: Staff may not post — same role machinery, exercised through
    // the actual controller method.
    const controller = new TransactionsController();
    await expect(
      controller.post({ userId: STAFF } as never, TENANT, outcome.transactionId),
    ).rejects.toThrow(/owner or manager/);

    // Still a draft: BAS must not see it yet. A draft is not a lodgement.
    const stillDraftBas = await basReport(OWNER, TENANT, FROM, TO);
    expect(stillDraftBas.G1).toBe('0.0000');

    const posted = await controller.post({ userId: OWNER } as never, TENANT, outcome.transactionId);
    expect(posted).toEqual({ transactionId: outcome.transactionId, status: 'posted' });

    // This is the whole point: G1 and 1A move, and 1A ≈ G1/11 reconciles.
    const after = await basReport(OWNER, TENANT, FROM, TO);
    expect(after.G1).toBe('1100.0000');
    expect(after['1A']).toBe('100.0000');
    const check1A = after.reconciliation.find((c) => c.label === '1A');
    expect(check1A?.withinTolerance).toBe(true);
  });

  it('refuses to draft from an invoice still in draft', async () => {
    const invoiceId = await makeInvoice(admin, { status: 'draft', net: '500.0000', gst: '50.0000' });
    const outcome = await draftTransactionFromInvoice(OWNER, TENANT, invoiceId);
    expect(outcome).toMatchObject({ ok: false, reason: 'not_sent', status: 'draft' });
  });

  it('a GST-free/export sale contributes to G1 and NOT to 1A', async () => {
    const before = await basReport(OWNER, TENANT, FROM, TO);

    const invoiceId = await makeInvoice(admin, {
      status: 'sent',
      net: '500.0000',
      gst: '0.0000',
      itemTaxCode: 'EXP',
    });
    const outcome = await draftTransactionFromInvoice(OWNER, TENANT, invoiceId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [txn] = await listTransactions(OWNER, TENANT, { status: 'draft' });
    const found = [txn].find((t) => t?.id === outcome.transactionId);
    const revenue = found!.splits.find((s) => s.accountName === 'Sales Revenue');
    expect(revenue?.taxCode).toBe('EXP');
    expect(revenue?.gstAmount).toBe('0.0000');
    // No GST payable split at all: the group's GST is zero.
    expect(found!.splits.some((s) => s.accountName === 'GST Payable')).toBe(false);

    const posted = await postTransaction(OWNER, TENANT, outcome.transactionId);
    expect(posted).toEqual({ ok: true });

    const after = await basReport(OWNER, TENANT, FROM, TO);
    // G1 grows by the export sale's gross (500 + 0 GST); 1A does not move —
    // EXP's sale_labels are {G1}, not {G1,1A} (migration 0005).
    expect(Number(after.G1) - Number(before.G1)).toBeCloseTo(500, 4);
    expect(after['1A']).toBe(before['1A']);
  });

  it('rejects an unbalanced posted sale-shaped transaction at COMMIT', async () => {
    const revenueAccount = randomUUID();
    const receivableAccount = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into accounts (id, tenant_id, code, name, account_type) values
          (${revenueAccount}, ${TENANT}, 'TEST-SALE-REV', 'Test sale revenue', 'income'),
          (${receivableAccount}, ${TENANT}, 'TEST-SALE-AR', 'Test sale receivable', 'asset')
      `);
    });

    // Revenue -100 (credit), receivable +90 (debit): off by ten dollars.
    const badTxn = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into transactions (id, tenant_id, txn_date, status, source)
        values (${badTxn}, ${TENANT}, current_date, 'draft', 'manual')
      `);
      await t.execute(sql`
        insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount) values
          (${randomUUID()}, ${TENANT}, ${badTxn}, 1, ${revenueAccount}, -100.0000),
          (${randomUUID()}, ${TENANT}, ${badTxn}, 2, ${receivableAccount}, 90.0000)
      `);
    });

    let rejection: unknown;
    try {
      await postTransaction(OWNER, TENANT, badTxn);
      throw new Error('expected postTransaction to reject');
    } catch (err) {
      rejection = err;
    }
    expect((rejection as { query?: string }).query).toBe('commit');
    expect((rejection as { cause?: { code?: string } }).cause?.code).toBe('23514'); // check_violation

    const stillDraft = await withTenantAs(getDb(), OWNER, TENANT, (t) =>
      t.execute<{ status: string }>(sql`select status::text as status from transactions where id = ${badTxn}`),
    );
    expect(stillDraft.rows[0]?.status).toBe('draft');

    // The balanced version of the same shape succeeds, proving the
    // rejection above was about the sum, not the tenant or the accounts.
    const goodTxn = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into transactions (id, tenant_id, txn_date, status, source)
        values (${goodTxn}, ${TENANT}, current_date, 'draft', 'manual')
      `);
      await t.execute(sql`
        insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount) values
          (${randomUUID()}, ${TENANT}, ${goodTxn}, 1, ${revenueAccount}, -100.0000),
          (${randomUUID()}, ${TENANT}, ${goodTxn}, 2, ${receivableAccount}, 100.0000)
      `);
    });
    const outcome = await postTransaction(OWNER, TENANT, goodTxn);
    expect(outcome).toEqual({ ok: true });
  });
});
