import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { saveExtraction, updateDocument } from '../repo.js';
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
 */

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const TENANT = '11111111-1111-4111-8111-111111111111';
const WORKER = '44444444-4444-4444-8444-444444444444';
const KATE = '33333333-3333-4333-8333-333333333331';

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

const captures: string[] = [];

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
  captures.push(id);
  return id;
}

describeIfDb('re-extraction', () => {
  beforeAll(async () => {
    // Fail loudly rather than silently testing nothing.
    await q(sql`select 1`);
  });

  afterAll(async () => {
    for (const id of captures) {
      await q(sql`delete from captures where id = ${id}`);
    }
    await closeDb();
  });

  it('runs twice over the same capture instead of failing', async () => {
    const capture = await makeCapture();
    const first = await saveExtraction(WORKER, TENANT, capture, reading(), META);
    // The bug: this call used to throw a foreign-key violation and roll back.
    const second = await saveExtraction(WORKER, TENANT, capture, reading({ payable: '120.00' }), META);

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
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META);

    // A person corrects the total. That must lock it.
    const edit = await updateDocument(KATE, TENANT, documentId, { payableAmount: '999.00' });
    expect(edit.ok).toBe(true);

    const locked = await q<{ locked_fields: string[] }>(sql`
      select locked_fields from documents where id = ${documentId}
    `);
    expect(locked.rows[0]?.locked_fields).toContain('header.payable_amount');

    // A later model disagrees. It loses.
    await saveExtraction(WORKER, TENANT, capture, reading({ payable: '110.00' }), META);

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
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META);

    // A posted transaction referencing it. Balanced, because the database
    // refuses to post anything else.
    const txnId = randomUUID();
    const accounts = await q<{ id: string }>(sql`
      select id from accounts where tenant_id = ${TENANT} order by code limit 2
    `);
    const [debit, credit] = accounts.rows;
    if (!debit || !credit) return; // no seeded chart of accounts; nothing to assert

    await q(sql`
      insert into transactions (id, tenant_id, document_id, occurred_on, description, status, created_by)
      values (${txnId}, ${TENANT}, ${documentId}, current_date, 'test', 'draft', ${KATE})
    `);
    await q(sql`
      insert into transaction_splits (id, tenant_id, transaction_id, account_id, amount)
      values (${randomUUID()}, ${TENANT}, ${txnId}, ${debit.id}, 110.0000),
             (${randomUUID()}, ${TENANT}, ${txnId}, ${credit.id}, -110.0000)
    `);
    await q(sql`update transactions set status = 'posted' where id = ${txnId}`);

    await saveExtraction(WORKER, TENANT, capture, reading({ payable: '500.00' }), META);

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
