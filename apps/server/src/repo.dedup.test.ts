import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from './db.js';
import { saveExtraction, updateDocument } from './repo.js';
import { provisionTenant, wipeTenant } from './test-support/tenant.js';
import type { ValidatedExtraction } from './extraction/types.js';

/**
 * R5e (`docs/STATEMENTS.md` §12 Lane R): the writer for
 * `documents.dedup_group_id` — *"business-key fingerprint group; flag, never
 * auto-merge"*. Document-to-document, receipt side: `md5(tenant ||
 * supplier name_normalised || issue_date || payable)::uuid`, computed in
 * `saveExtraction`, NULL when any part is missing.
 *
 * Runs against real Postgres as the application role, following
 * `extraction/reextraction.test.ts`'s pattern: a disposable tenant, torn
 * down after.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-000000000001';
const WORKER = 'd0d0d0d0-0000-4000-8000-0000000000a1';
const KATE = 'd0d0d0d0-0000-4000-8000-0000000000a2';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: ReturnType<typeof sql>,
  userId: string = WORKER,
) => withTenantAs(getDb(), userId, TENANT, (tx) => tx.execute<T>(text));

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

/** A reading, as the validators hand it to the repo. Every business-key part
 *  (supplier name, issue date, payable amount) is overridable so a test can
 *  null one out individually. */
function reading(
  over: { supplier?: string | null; date?: string | null; payable?: string | null } = {},
): ValidatedExtraction {
  const supplier = over.supplier === undefined ? 'Sunrise Cafe Pty Ltd' : over.supplier;
  const date = over.date === undefined ? '2026-08-14' : over.date;
  const payable = over.payable === undefined ? '42.50' : over.payable;
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('receipt' as const),
      saysTaxInvoice: f(false),
      documentNumber: f('RX-DEDUP'),
      issueDate: f(date),
      currency: f('AUD'),
      supplierName: f(supplier),
      supplierAbn: f(null),
      buyerIdentified: f(false),
      taxExclusiveAmount: f('38.64'),
      taxAmount: f('3.86'),
      payableAmount: f(payable),
      lines: [
        {
          description: f('Lunch'),
          quantity: f(1),
          unitPrice: f(payable ?? '42.50'),
          amount: f(payable ?? '42.50'),
          gstFree: f(false),
        },
      ],
      notes: { legible: true, imageIssues: [], warnings: [] },
    },
    findings: [],
    complianceFailures: [],
    isTaxInvoice: false,
    belowTaxInvoiceThreshold: true,
    gstAtRisk: null,
    reviewStatus: 'needs_review',
    confidenceOverall: 0.9,
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

/** A capture to hang a document off, as the tenant, not as a superuser —
 *  each call gets its own distinct bytes, so `captures_sha_unique` never
 *  interferes with a suite that is deliberately testing a DIFFERENT dedup
 *  path (business-key, not byte-identity). */
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

describeIfDb('documents.dedup_group_id — receipt-side writer (R5e)', () => {
  let admin: Client;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Dedup test co',
      users: [
        { id: WORKER, role: 'member', subject: 'test|dedup-worker', email: 'worker@dedup.test', displayName: 'Worker' },
        { id: KATE, role: 'owner', subject: 'test|dedup-kate', email: 'kate@dedup.test', displayName: 'Kate' },
      ],
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [WORKER, KATE]);
    await admin.end();
    await closeDb();
  });

  it('a re-photographed docket (different bytes, same business key) groups and raises one task naming both', async () => {
    const captureA = await makeCapture();
    const captureB = await makeCapture();

    const { documentId: docA } = await saveExtraction(WORKER, TENANT, captureA, reading(), META, null);
    const { documentId: docB } = await saveExtraction(WORKER, TENANT, captureB, reading(), META, null);

    const rows = await q<{ id: string; dedup_group_id: string | null }>(sql`
      select id, dedup_group_id::text as dedup_group_id from documents where id in (${docA}, ${docB})
    `);
    const byId = new Map(rows.rows.map((r) => [r.id, r.dedup_group_id]));
    expect(byId.get(docA)).not.toBeNull();
    expect(byId.get(docA)).toBe(byId.get(docB));

    const tasks = await q<{ document_id: string; reason: string; detail: { documentIds: string[] } }>(sql`
      select document_id, reason, detail from review_tasks where reason = 'possible_duplicate'
    `);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]?.detail.documentIds.sort()).toEqual([docA, docB].sort());

    // A third re-scan of the same docket does not raise a second task for the
    // same group — one alert per group, not one per pair.
    const captureC = await makeCapture();
    await saveExtraction(WORKER, TENANT, captureC, reading(), META, null);
    const tasksAfterThird = await q<{ id: string }>(sql`
      select id from review_tasks where reason = 'possible_duplicate'
    `);
    expect(tasksAfterThird.rows).toHaveLength(1);
  });

  it('a receipt missing any fingerprint part gets a NULL group and no task — not a collision with every other partial document', async () => {
    const captureNoSupplier = await makeCapture();
    const captureNoDate = await makeCapture();
    const captureNoPayable = await makeCapture();

    const { documentId: docNoSupplier } = await saveExtraction(
      WORKER, TENANT, captureNoSupplier, reading({ supplier: null }), META, null,
    );
    const { documentId: docNoDate } = await saveExtraction(
      WORKER, TENANT, captureNoDate, reading({ date: null }), META, null,
    );
    const { documentId: docNoPayable } = await saveExtraction(
      WORKER, TENANT, captureNoPayable, reading({ payable: null }), META, null,
    );

    const rows = await q<{ id: string; dedup_group_id: string | null }>(sql`
      select id, dedup_group_id from documents
       where id in (${docNoSupplier}, ${docNoDate}, ${docNoPayable})
    `);
    for (const r of rows.rows) {
      expect(r.dedup_group_id).toBeNull();
    }

    // Three separately-partial documents must NOT be silently grouped with
    // each other just because they all resolved to NULL. Scoped to these
    // three documents specifically — an earlier test in this suite already
    // raised an unrelated possible_duplicate task for its own group.
    const tasks = await q<{ id: string }>(sql`
      select id from review_tasks
       where reason = 'possible_duplicate'
         and document_id in (${docNoSupplier}, ${docNoDate}, ${docNoPayable})
    `);
    expect(tasks.rows).toHaveLength(0);
  });

  it('resolving the possible_duplicate task through the existing reject flow leaves both documents rows present', async () => {
    const captureA = await makeCapture();
    const captureB = await makeCapture();
    const { documentId: docA } = await saveExtraction(
      WORKER, TENANT, captureA, reading({ supplier: 'Refusal Test Supplier' }), META, null,
    );
    const { documentId: docB } = await saveExtraction(
      WORKER, TENANT, captureB, reading({ supplier: 'Refusal Test Supplier' }), META, null,
    );

    const task = await q<{ id: string }>(sql`
      select id from review_tasks
       where reason = 'possible_duplicate' and detail->>'dedupGroupId' = (
         select dedup_group_id::text from documents where id = ${docA}
       )
    `);
    expect(task.rows).toHaveLength(1);

    // The existing reject flow: reject the duplicate, never delete it.
    const rejected = await updateDocument(KATE, TENANT, docB, { reviewStatus: 'rejected' });
    expect(rejected.ok).toBe(true);

    const after = await q<{ id: string; review_status: string; deleted_at: string | null }>(sql`
      select id, review_status, deleted_at from documents where id in (${docA}, ${docB})
    `);
    expect(after.rows).toHaveLength(2);
    for (const row of after.rows) {
      expect(row.deleted_at).toBeNull();
    }
    expect(after.rows.find((r) => r.id === docB)?.review_status).toBe('rejected');
  });
});
