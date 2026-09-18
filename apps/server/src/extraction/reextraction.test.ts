import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { saveExtraction, updateDocument } from '../repo.js';
import { makeAccount, provisionTenant, wipeTenant } from '../test-support/tenant.js';
import type { ValidatedExtraction } from './types.js';

/**
 * Re-extraction: what a second run may and may not do to a curated document.
 *
 * Migration 0009 states three guarantees and enforces only the narrowest of
 * them in the database. These are the other two, and they were both broken
 * until the Phase 0 gate re-ran extraction over a document that already
 * existed:
 *
 *   - It failed outright. `on conflict (capture_id) do nothing` skipped the
 *     insert, and the lines that followed referenced an id nothing had
 *     persisted. Replayability — the reason a cheap model is safe — was
 *     first-run-only.
 *   - Nothing ever wrote `locked_fields`, so "a human edit outranks any later
 *     machine run" was guarding an empty set.
 *
 * Runs against a real Postgres, as a real non-superuser role, because every
 * rule here is half SQL. Skips cleanly without a database rather than passing
 * vacuously.
 *
 * This used to run against the shared seeded tenant
 * (`11111111-1111-4111-8111-111111111111`) and its worker/Kate users, which
 * another lane's suites also seed and re-seed — the exact reason this suite
 * started failing (a re-seed left `documents`/`transactions` at 0 rows mid-run,
 * with nothing wrong in the code under test). It now provisions its own
 * disposable tenant, worker, and reviewer, the same pattern as
 * `transactions.sale.test.ts`, so it starts from a known state regardless of
 * what any other process does to the shared database.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c3c3c3c3-0000-4000-8000-000000000001';
const WORKER = 'c3c3c3c3-0000-4000-8000-0000000000a1';
const KATE = 'c3c3c3c3-0000-4000-8000-0000000000a2';

/**
 * Every query goes through the tenant context, as the worker's own account.
 *
 * Not a convenience: a bare `getDb().execute` has no `app.tenant_id` set, so
 * row-level security refuses it — which it did, first run. A test that reached
 * around RLS to set itself up would also be proving nothing about the rules it
 * is asserting.
 */
const q = <T extends Record<string, unknown> = Record<string, unknown>>(text: ReturnType<typeof sql>, userId: string = WORKER) =>
  withTenantAs(getDb(), userId, TENANT, (tx) => tx.execute<T>(text));

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

/** A reading, as the validators hand it to the repo. */
function reading(over: { payable?: string; gst?: string; date?: string } = {}): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('tax_invoice' as const),
      saysTaxInvoice: f(true),
      documentNumber: f('RX-1'),
      issueDate: f(over.date ?? '2026-08-14'),
      currency: f('AUD'),
      supplierName: f('Southern Cross Logistics Pty Ltd'),
      supplierAbn: f('85129887341'),
      buyerIdentified: f(true),
      taxExclusiveAmount: f('100.00'),
      taxAmount: f(over.gst ?? '10.00'),
      payableAmount: f(over.payable ?? '110.00'),
      lines: [
        {
          description: f('Freight'),
          quantity: f(1),
          unitPrice: f(over.payable ?? '110.00'),
          amount: f(over.payable ?? '110.00'),
          gstFree: f(false),
        },
      ],
      notes: { legible: true, imageIssues: [], warnings: [] },
    },
    findings: [],
    complianceFailures: [],
    isTaxInvoice: true,
    belowTaxInvoiceThreshold: false,
    gstAtRisk: null,
    reviewStatus: 'auto_accepted',
    confidenceOverall: 0.99,
  };
}

const META = {
  model: 'gemma4:31b',
  promptVersion: 'test',
  latencyMs: 1,
  inputTokens: 1,
  outputTokens: 1,
  raw: '{}',
};

/** A capture to hang a document off. Created as the tenant, not as a superuser. */
async function makeCapture(): Promise<string> {
  const id = randomUUID();
  await q(sql`
    insert into captures (
      id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
      original_byte_size, original_sha256, status
    ) values (
      ${id}, ${TENANT}, ${WORKER}, ${`${TENANT}/originals/test/${id}`}, 'image/png',
      1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received'
    )
  `);
  return id;
}

describeIfDb('re-extraction', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Re-extraction test co',
      users: [
        {
          id: WORKER,
          role: 'member',
          subject: 'test|reextraction-worker',
          email: 'worker@reextraction.test',
          displayName: 'Extraction Worker',
        },
        {
          id: KATE,
          role: 'owner',
          subject: 'test|reextraction-kate',
          email: 'kate@reextraction.test',
          displayName: 'Kate Reviewer',
        },
      ],
    });
    // A minimal chart of accounts — just enough for the third test's posted
    // transaction to reference two real accounts. Without this, that test
    // used to silently skip its own assertion (`if (!debit || !credit) return`)
    // whenever the tenant had no seeded accounts; provisioning our own means
    // that guard is never the reason the test does nothing.
    await makeAccount(admin, TENANT, '6-0000', 'Test expense', 'expense');
    await makeAccount(admin, TENANT, '2-1000', 'Test payable', 'liability');
  });

  afterAll(async () => {
    if (!hasDb) return;
    // wipeTenant deletes every capture (and, by cascade, every document,
    // extraction run, and review task) for this tenant in one pass — the
    // per-capture loop this suite used to run by hand is redundant now that
    // cleanup is tenant-scoped rather than capture-scoped.
    await wipeTenant(admin, TENANT, [WORKER, KATE]);
    await admin.end();
    await closeDb();
  });

  it('runs twice over the same capture instead of failing', async () => {
    const capture = await makeCapture();
    const first = await saveExtraction(WORKER, TENANT, capture, reading(), META, null);
    // The bug: this call used to throw a foreign-key violation and roll back.
    const second = await saveExtraction(WORKER, TENANT, capture, reading({ payable: '120.00' }), META, null);

    expect(second.documentId).toBe(first.documentId);

    const row = await q<{ payable_amount: string; lines: string; runs: string }>(sql`
      select d.payable_amount::text,
             (select count(*) from document_lines l where l.document_id = d.id)::text as lines,
             (select count(*) from extraction_runs r where r.capture_id = d.capture_id)::text as runs
        from documents d where d.id = ${first.documentId}
    `);
    expect(row.rows[0]?.payable_amount).toContain('120');
    // Replaced as a set, not appended to.
    expect(row.rows[0]?.lines).toBe('1');
    // Both runs survive: the old reading is evidence, not rubbish.
    expect(row.rows[0]?.runs).toBe('2');
  });

  it('does not overwrite a field a human has settled', async () => {
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META, null);

    // A person corrects the total. That must lock it.
    const edit = await updateDocument(KATE, TENANT, documentId, { payableAmount: '999.00' });
    expect(edit.ok).toBe(true);

    const locked = await q<{ locked_fields: string[] }>(sql`
      select locked_fields from documents where id = ${documentId}
    `);
    expect(locked.rows[0]?.locked_fields).toContain('header.payable_amount');

    // A later model disagrees. It loses.
    await saveExtraction(WORKER, TENANT, capture, reading({ payable: '110.00' }), META, null);

    const after = await q<{ payable_amount: string; review_status: string }>(sql`
      select payable_amount::text, review_status::text from documents where id = ${documentId}
    `);
    expect(after.rows[0]?.payable_amount).toContain('999');
    // And the disagreement is surfaced rather than swallowed.
    expect(after.rows[0]?.review_status).toBe('needs_review');

    const task = await q<{ reason: string }>(sql`
      select reason from review_tasks
       where document_id = ${documentId} and reason = 'reextraction_disagrees_with_human'
    `);
    expect(task.rows.length).toBe(1);
  });

  it('leaves a document behind a posted transaction completely alone', async () => {
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META, null);

    // A posted transaction referencing it. Balanced, because the database
    // refuses to post anything else. The two accounts come from this
    // fixture's own chart of accounts (seeded in `beforeAll`) — no dependency
    // on whatever chart of accounts, if any, another suite happens to leave
    // behind for a shared tenant.
    const txnId = randomUUID();
    const accounts = await q<{ id: string }>(sql`
      select id from accounts where tenant_id = ${TENANT} order by code limit 2
    `);
    const [debit, credit] = accounts.rows;
    if (!debit || !credit) throw new Error('fixture failed to provision a chart of accounts');

    // ONE STATEMENT, and that is the point. 0032's
    // `assert_document_id_matches_observation` is DEFERRED, so it fires at
    // COMMIT — and every `q()` here commits on its own. Inserting the
    // transaction and its observation as two calls fires the trigger at the
    // first commit, when the observation does not exist yet, and the fixture
    // fails describing a state it was halfway through creating.
    //
    // `draftTransactionFromDocument` writes both inside one `withTenantAs`,
    // which is why the real path never sees this. A raw-SQL fixture has to
    // reproduce that atomicity rather than work around the trigger: the
    // invariant — a non-void transaction naming a document HAS its observation
    // — is exactly what the register exists to guarantee.
    await q(sql`
      with t as (
        insert into transactions (id, tenant_id, document_id, txn_date, memo, status)
        values (${txnId}, ${TENANT}, ${documentId}, current_date, 'test', 'draft')
        returning id, tenant_id, document_id
      )
      insert into event_observations (id, tenant_id, transaction_id, kind, document_id)
      select ${randomUUID()}, t.tenant_id, t.id, 'document', t.document_id from t
    `);
    await q(sql`
      insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount)
      values (${randomUUID()}, ${TENANT}, ${txnId}, 1, ${debit.id}, 110.0000),
             (${randomUUID()}, ${TENANT}, ${txnId}, 2, ${credit.id}, -110.0000)
    `);
    // `posted_at` is required alongside `status = 'posted'` (migration 0006's
    // `txn_posted_has_timestamp` check).
    await q(sql`update transactions set status = 'posted', posted_at = now(), posted_by = ${KATE} where id = ${txnId}`);

    await saveExtraction(WORKER, TENANT, capture, reading({ payable: '500.00' }), META, null);

    const after = await q<{ payable_amount: string }>(sql`
      select payable_amount::text from documents where id = ${documentId}
    `);
    // The books do not move because a model changed its mind.
    expect(after.rows[0]?.payable_amount).toContain('110');

    const task = await q<{ reason: string }>(sql`
      select reason from review_tasks
       where document_id = ${documentId} and reason = 'reextraction_after_posting'
    `);
    expect(task.rows.length).toBe(1);

    await q(sql`delete from transactions where id = ${txnId}`);
  });
});
