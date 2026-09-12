import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { closeDb, getDb } from '../db.js';
import { provisionTenant, sha256hex, wipeTenant } from '../test-support/tenant.js';
import {
  draftTransactionFromDocument,
  listTransactions,
  postTransaction,
} from './transactions.repo.js';
import { TransactionsController } from './transactions.controller.js';

/**
 * The ledger stops being decorative — `docs/contracts/alpha-gaps.md` Lane L.
 *
 * Runs against a real Postgres, as the real `snap_app` role for everything
 * this ticket's endpoints actually do, because the one rule that matters —
 * "sum of splits is zero, or Postgres refuses the posting" — is not
 * something a mock can exercise. Only fixture setup (creating a tenant, its
 * people, and the documents to post from) uses a privileged connection, the
 * same convention as `repo.test.ts`: the app role cannot create a tenant, and
 * proving otherwise is not the point of this suite.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'a1a1a1a1-0000-4000-8000-000000000001';
const OWNER = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const STAFF = 'a1a1a1a1-0000-4000-8000-0000000000a2';

/** A minimal capture row — just enough for `documents.capture_id`'s FK. */
async function makeCapture(admin: Client, tenantId: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
     values ($1, $2, $3, 'image/jpeg', 1000, decode($4, 'hex'))`,
    [id, tenantId, `test/${id}.jpg`, sha256hex()],
  );
  return id;
}

/** A minimal, already-reviewed document with lines, no capital-P plumbing. */
async function makeDocument(
  admin: Client,
  tenantId: string,
  captureId: string,
  opts: {
    isTaxInvoice: boolean;
    taxExclusive: string;
    tax: string;
    payable: string;
    lines: Array<{ net: string; category: string }>;
    reviewStatus?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into documents (
       id, tenant_id, capture_id, is_tax_invoice, review_status,
       document_number, issue_date, tax_exclusive_amount, tax_amount, payable_amount
     ) values ($1, $2, $3, $4, $5::review_status, $6, current_date, $7, $8, $9)`,
    [
      id,
      tenantId,
      captureId,
      opts.isTaxInvoice,
      opts.reviewStatus ?? 'reviewed',
      `TEST-${id.slice(0, 8)}`,
      opts.taxExclusive,
      opts.tax,
      opts.payable,
    ],
  );
  let lineNumber = 1;
  for (const line of opts.lines) {
    await admin.query(
      `insert into document_lines (id, tenant_id, document_id, line_number, description, line_net_amount, gst_category_code)
       values ($1, $2, $3, $4, 'test line', $5, $6)`,
      [randomUUID(), tenantId, id, lineNumber, line.net, line.category],
    );
    lineNumber += 1;
  }
  return id;
}

describeIfDb('transactions: draft, post, list', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Lane L test co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|owner', email: 'owner@lanel.test', displayName: 'Owner Test' },
        { id: STAFF, role: 'member', subject: 'test|staff', email: 'staff@lanel.test', displayName: 'Staff Test' },
      ],
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [OWNER, STAFF]);
    await admin.end();
    await closeDb();
  });

  /**
   * The one that matters most: does the DATABASE reject an unbalanced
   * posting, independent of anything this ticket's TypeScript computed?
   *
   * Both directions are asserted with the SAME code path (`postTransaction`,
   * which does nothing but flip `status` to `'posted'`), so that if the
   * unbalanced case were ever accepted by some accident of setup, the
   * balanced case failing too would say so. A test that only tried the bad
   * case could be "passing" because the fixture itself was broken — this
   * cannot be, because the good case must also succeed.
   */
  it('rejects an unbalanced posted transaction at COMMIT, and accepts a balanced one', async () => {
    const debitAccount = randomUUID();
    const creditAccount = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into accounts (id, tenant_id, code, name, account_type) values
          (${debitAccount}, ${TENANT}, 'TEST-DR', 'Test debit', 'expense'),
          (${creditAccount}, ${TENANT}, 'TEST-CR', 'Test credit', 'liability')
      `);
    });

    // The bad transaction: 100 debit, 90 credit. Off by ten dollars.
    const badTxn = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into transactions (id, tenant_id, txn_date, status, source)
        values (${badTxn}, ${TENANT}, current_date, 'draft', 'manual')
      `);
      await t.execute(sql`
        insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount) values
          (${randomUUID()}, ${TENANT}, ${badTxn}, 1, ${debitAccount}, 100.0000),
          (${randomUUID()}, ${TENANT}, ${badTxn}, 2, ${creditAccount}, -90.0000)
      `);
    });

    // This is `postTransaction` — the same function the controller calls —
    // not a raw SQL assertion invented for this test. The rejection is of
    // the COMMIT itself (drizzle names the failing statement "commit"),
    // which is the deferred trigger firing at the moment migration 0006
    // documents, not at the earlier `UPDATE ... SET status = 'posted'`.
    // Drizzle wraps the driver's error in its own `DrizzleQueryError`, so the
    // SQLSTATE lives on `.cause`, not on the error itself — asserted here so
    // that fact is pinned rather than rediscovered.
    let rejection: unknown;
    try {
      await postTransaction(OWNER, TENANT, badTxn);
      throw new Error('expected postTransaction to reject');
    } catch (err) {
      rejection = err;
    }
    expect((rejection as { query?: string }).query).toBe('commit');
    expect((rejection as { cause?: { code?: string } }).cause?.code).toBe('23514'); // check_violation
    expect((rejection as { cause?: { message?: string } }).cause?.message).toMatch(
      /is not balanced: splits sum to 10\.0000/,
    );

    // The bad transaction must still be a DRAFT: Postgres rolled the whole
    // commit back, `status` included, not just refused the balance check
    // and left a posted-but-wrong row behind.
    const stillDraft = await withTenantAs(getDb(), OWNER, TENANT, (t) =>
      t.execute<{ status: string }>(sql`select status::text as status from transactions where id = ${badTxn}`),
    );
    expect(stillDraft.rows[0]?.status).toBe('draft');

    // The good transaction: same shape, correct amount. Proves the rejection
    // above was about the sum, not about the tenant, the accounts, or the
    // draft→posted transition in general.
    const goodTxn = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into transactions (id, tenant_id, txn_date, status, source)
        values (${goodTxn}, ${TENANT}, current_date, 'draft', 'manual')
      `);
      await t.execute(sql`
        insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount) values
          (${randomUUID()}, ${TENANT}, ${goodTxn}, 1, ${debitAccount}, 100.0000),
          (${randomUUID()}, ${TENANT}, ${goodTxn}, 2, ${creditAccount}, -100.0000)
      `);
    });
    const outcome = await postTransaction(OWNER, TENANT, goodTxn);
    expect(outcome).toEqual({ ok: true });

    // And through the actual controller, the same rejection must not reach
    // a caller as a raw 500: `TransactionsController#post` translates the
    // driver's `.cause.code` into a clean 409. This is what proved worth
    // fixing here — the first version of that catch block looked at `.code`
    // only, which does not exist on drizzle's wrapper error, so a real
    // unbalanced posting would have surfaced as an unhandled 500 despite the
    // repo-level test above passing.
    const anotherBadTxn = randomUUID();
    await withTenantAs(getDb(), OWNER, TENANT, async (t) => {
      await t.execute(sql`
        insert into transactions (id, tenant_id, txn_date, status, source)
        values (${anotherBadTxn}, ${TENANT}, current_date, 'draft', 'manual')
      `);
      await t.execute(sql`
        insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount) values
          (${randomUUID()}, ${TENANT}, ${anotherBadTxn}, 1, ${debitAccount}, 5.0000),
          (${randomUUID()}, ${TENANT}, ${anotherBadTxn}, 2, ${creditAccount}, -1.0000)
      `);
    });
    const controllerForBalance = new TransactionsController();
    await expect(
      controllerForBalance.post({ userId: OWNER } as never, TENANT, anotherBadTxn),
    ).rejects.toThrow(/do not sum to zero/);
  });

  it('drafts a balanced transaction from a valid tax invoice, GST posted as claimable', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      taxExclusive: '100.0000',
      tax: '10.0000',
      payable: '110.0000',
      lines: [{ net: '100.0000', category: 'S' }],
    });

    const outcome = await draftTransactionFromDocument(OWNER, TENANT, documentId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [txn] = await listTransactions(OWNER, TENANT, { status: 'draft' });
    expect(txn?.id).toBe(outcome.transactionId);
    expect(txn?.documentId).toBe(documentId);

    // The worked example in `docs/PLAN.md` §5, exactly: expense +100 (tagged
    // GST, gst_amount 10), GST Receivable +10 (untagged control line),
    // payment leg -110. Sum zero.
    const amounts = txn!.splits.map((s) => Number(s.amount));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 4);

    const claimable = txn!.splits.find((s) => s.accountName === 'GST Receivable');
    expect(claimable?.amount).toBe('10.0000');
    expect(claimable?.taxCodeId).toBeNull(); // control posting, never double-counted

    const netSplit = txn!.splits.find((s) => s.taxCode === 'GST');
    expect(netSplit?.amount).toBe('100.0000');
    expect(netSplit?.gstAmount).toBe('10.0000');

    // Rule 3: a document that already has a live transaction may not get a
    // second one.
    const second = await draftTransactionFromDocument(OWNER, TENANT, documentId);
    expect(second).toMatchObject({ ok: false, reason: 'already_posted' });

    // Rule 4: Staff may capture, not post. Exercised through the actual
    // controller method, which is where the role check lives — not a copy of
    // its logic asserted in isolation.
    const controller = new TransactionsController();
    await expect(controller.post({ userId: STAFF } as never, TENANT, outcome.transactionId)).rejects.toThrow(
      /owner or manager/,
    );

    const posted = await controller.post({ userId: OWNER } as never, TENANT, outcome.transactionId);
    expect(posted).toEqual({ transactionId: outcome.transactionId, status: 'posted' });

    const [postedTxn] = await listTransactions(OWNER, TENANT, { status: 'posted' });
    expect(postedTxn?.id).toBe(outcome.transactionId);
  });

  it('a document that is not a valid tax invoice never produces a claimable GST split', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: false,
      taxExclusive: '200.0000',
      tax: '20.0000',
      payable: '220.0000',
      lines: [{ net: '200.0000', category: 'S' }],
    });

    const outcome = await draftTransactionFromDocument(OWNER, TENANT, documentId);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [txn] = await listTransactions(OWNER, TENANT, { status: 'draft' });
    const found = [txn].find((t) => t?.id === outcome.transactionId) ?? txn;

    // `is_tax_invoice` is consumed, never recomputed: the GST is still
    // identified (tax code + gst_amount on the net split) so an "unclaimable
    // GST" figure can exist at all —
    const netSplit = found!.splits.find((s) => s.taxCode === 'GST');
    expect(netSplit?.gstAmount).toBe('20.0000');

    // — but no split increased the claimable GST Receivable asset. It went
    // to the unclaimable expense account instead.
    expect(found!.splits.some((s) => s.accountName === 'GST Receivable')).toBe(false);
    const unclaimable = found!.splits.find((s) => s.accountName === 'GST Paid — Not Claimable');
    expect(unclaimable?.amount).toBe('20.0000');
    expect(unclaimable?.accountType).toBe('expense');

    const amounts = found!.splits.map((s) => Number(s.amount));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 4);
  });

  it('refuses to draft from a document still needing review', async () => {
    const capture = await makeCapture(admin, TENANT);
    const documentId = await makeDocument(admin, TENANT, capture, {
      isTaxInvoice: true,
      taxExclusive: '50.0000',
      tax: '5.0000',
      payable: '55.0000',
      lines: [{ net: '50.0000', category: 'S' }],
      reviewStatus: 'needs_review',
    });

    const outcome = await draftTransactionFromDocument(OWNER, TENANT, documentId);
    expect(outcome).toMatchObject({ ok: false, reason: 'not_confirmed', reviewStatus: 'needs_review' });
  });
});
