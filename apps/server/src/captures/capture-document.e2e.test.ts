import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import type { ValidatedExtraction } from '../extraction/types.js';

/**
 * OD-11, against a real database as the application role.
 *
 * `docs/ON-DEVICE.md` §7.2 states the hazard as three ORDERINGS of the same
 * two events — a correction arriving, and extraction producing a document —
 * plus a fourth axis, the outbox replaying its own request:
 *
 *   1. Correction arrives BEFORE extraction has run at all.      -> 409, retried.
 *   2. Correction arrives AFTER extraction has run once.         -> applied, locked.
 *   3. Extraction runs AGAIN after the correction is applied.    -> contested, kept.
 *   4. The SAME correction request is replayed (an outbox retry). -> no double-apply.
 *
 * A first implementation that gets any one of these wrong quietly loses a
 * human's edit — either by rejecting it outright (case 1), by letting a
 * later machine run stomp it (case 3), or by applying a "set the field to X"
 * request twice and calling that a bug when it (correctly) is not (case 4).
 * Every test below is one of those four orderings, named after it.
 *
 * Runs against a real Postgres, as `snap_app` — never a bypass role — because
 * RLS on `documents`/`captures` and the trigger on `locked_fields` (migration
 * 0009) are exactly what is under test, not incidental plumbing around it.
 * Uses the same disposable-tenant harness as `extraction/reextraction.test.ts`
 * rather than hand-rolled inserts, because this suite ALSO needs
 * `saveExtraction` to produce and re-produce a document — the same shape of
 * fixture that suite already needed.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-000000000001';
const OTHER_TENANT = 'd0d0d0d0-0000-4000-8000-000000000002';
const WORKER = 'd0d0d0d0-0000-4000-8000-0000000000a1';
const KATE = 'd0d0d0d0-0000-4000-8000-0000000000a2';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: ReturnType<typeof sql>,
  userId: string = WORKER,
  tenant: string = TENANT,
) => withTenantAs(getDb(), userId, tenant, (tx) => tx.execute<T>(text));

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

/** A reading, as the validators hand it to the repo — same shape as
 *  `reextraction.test.ts`'s fixture, since this suite exercises the same
 *  `saveExtraction` re-run path from the other side (a correction in between). */
function reading(over: { payable?: string } = {}): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('tax_invoice' as const),
      saysTaxInvoice: f(true),
      documentNumber: f('OD11-1'),
      issueDate: f('2026-08-14'),
      currency: f('AUD'),
      supplierName: f('Corner Store Pty Ltd'),
      supplierAbn: f('85129887341'),
      buyerIdentified: f(true),
      taxExclusiveAmount: f('100.00'),
      taxAmount: f('10.00'),
      payableAmount: f(over.payable ?? '110.00'),
      lines: [
        {
          description: f('Supplies'),
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

async function makeCapture(tenant: string = TENANT, uploadedBy: string = WORKER): Promise<string> {
  const id = randomUUID();
  await q(
    sql`
      insert into captures (
        id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
        original_byte_size, original_sha256, status
      ) values (
        ${id}, ${tenant}, ${uploadedBy}, ${`${tenant}/originals/test/${id}`}, 'image/png',
        1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received'
      )
    `,
    uploadedBy,
    tenant,
  );
  return id;
}

const user = { userId: WORKER, email: 'worker@od11.test', displayName: 'OD11 Worker', initials: 'OW' };

describeIfDb('PATCH /v1/captures/:id/document', () => {
  let admin: Client;
  let controller: InstanceType<
    typeof import('./capture-document.controller.js').CaptureDocumentController
  >;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'OD-11 test co',
      users: [
        { id: WORKER, role: 'member', subject: 'test|od11-worker', email: 'worker@od11.test', displayName: 'OD11 Worker' },
        { id: KATE, role: 'owner', subject: 'test|od11-kate', email: 'kate@od11.test', displayName: 'OD11 Kate' },
      ],
    });
    // A second tenant, membership-less for WORKER, so the 404 test proves
    // RLS is doing the isolating rather than an `if` the handler could get
    // wrong.
    await admin.query(
      `insert into tenants (id, name, abn, gst_registered) values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [OTHER_TENANT, 'OD-11 other co', '51824753556', true],
    );

    const mod = await import('./capture-document.controller.js');
    controller = new mod.CaptureDocumentController();
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.query('DELETE FROM tenants WHERE id = $1', [OTHER_TENANT]);
    await wipeTenant(admin, TENANT, [WORKER, KATE]);
    await admin.end();
    await closeDb();
  });

  it('1. 409s document_not_ready when extraction has not run at all', async () => {
    const capture = await makeCapture();

    let caught: unknown;
    try {
      await controller.patch(user, TENANT, capture, {
        edits: { 'totals.payable': '55.00' },
      } as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      status: 409,
      response: { error: 'document_not_ready' },
    });

    // The refusal must not have written anything either.
    const docs = await q<{ n: string }>(sql`
      select count(*)::text as n from documents where capture_id = ${capture}
    `);
    expect(docs.rows[0]?.n).toBe('0');
  });

  it('2. applies the correction once extraction has run, and LOCKS the path', async () => {
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META, null);

    const result = await controller.patch(user, TENANT, capture, {
      edits: { 'totals.payable': '55.00' },
    } as never);

    expect((result as { payableAmount: string }).payableAmount).toBe('55.0000');

    const row = await q<{ payable_amount: string; locked_fields: string[]; version: number }>(sql`
      select payable_amount::text, locked_fields, version from documents where id = ${documentId}
    `);
    expect(row.rows[0]?.payable_amount).toBe('55.0000');
    expect(row.rows[0]?.locked_fields).toContain('header.payable_amount');
  });

  it('3. a re-extraction that disagrees with the locked path is CONTESTED, not overwritten', async () => {
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META, null);
    await controller.patch(user, TENANT, capture, {
      edits: { 'totals.payable': '55.00' },
    } as never);

    // Extraction ran a SECOND time — "ran twice" — and disagrees.
    await saveExtraction(WORKER, TENANT, capture, reading({ payable: '110.00' }), META, null);

    const after = await q<{ payable_amount: string; review_status: string }>(sql`
      select payable_amount::text, review_status::text from documents where id = ${documentId}
    `);
    // The human's value is KEPT. A machine run losing this is the whole
    // reason `locked_fields` exists.
    expect(after.rows[0]?.payable_amount).toBe('55.0000');
    expect(after.rows[0]?.review_status).toBe('needs_review');

    // Two contests, not one: correcting the total also re-derives and locks
    // `header.tax_amount` (the same thing `PATCH /v1/documents/:id` does —
    // GST is never left stale next to a corrected total), so the second
    // extraction disagrees on BOTH locked columns. The one this test exists
    // to prove is the total; it is found by its `field`, not by assuming
    // there is only one row.
    const tasks = await q<{ detail: { field: string; kept: string; proposed: string } }>(sql`
      select detail from review_tasks
       where document_id = ${documentId} and reason = 'reextraction_disagrees_with_human'
    `);
    const payableContest = tasks.rows.find((r) => r.detail.field === 'header.payable_amount');
    expect(payableContest?.detail).toMatchObject({ kept: '55.0000', proposed: '110.00' });
  });

  it('4. replaying the same correction (an outbox retry) does not double-apply', async () => {
    const capture = await makeCapture();
    const { documentId } = await saveExtraction(WORKER, TENANT, capture, reading(), META, null);

    const first = await controller.patch(user, TENANT, capture, {
      edits: { 'totals.payable': '55.00' },
    } as never);
    const second = await controller.patch(user, TENANT, capture, {
      edits: { 'totals.payable': '55.00' },
    } as never);

    expect((first as { payableAmount: string }).payableAmount).toBe('55.0000');
    expect((second as { payableAmount: string }).payableAmount).toBe('55.0000');

    const row = await q<{ payable_amount: string; locked_fields: string[] }>(sql`
      select payable_amount::text, locked_fields from documents where id = ${documentId}
    `);
    expect(row.rows[0]?.payable_amount).toBe('55.0000');
    // Replaying the same "set it to X" is a no-op on the lock set, not a
    // second lock — `locked_fields` is a union, so a duplicate here would be
    // the first sign that a retry is doing more than the original request did.
    const occurrences = row.rows[0]!.locked_fields.filter((p) => p === 'header.payable_amount');
    expect(occurrences).toHaveLength(1);
  });

  it('refuses a capture belonging to another tenant — RLS, not a 409', async () => {
    // Inserted through the admin connection, not `q()`: WORKER has no
    // membership in OTHER_TENANT, so `withTenantAs` would refuse the insert
    // itself — this capture has to exist "some other way", the same as a real
    // cross-tenant id a client could send.
    const foreignCapture = randomUUID();
    await admin.query(
      `insert into captures (
         id, tenant_id, original_storage_key, original_mime_type,
         original_byte_size, original_sha256, status
       ) values ($1, $2, $3, 'image/png', 1024, decode(repeat('cd', 32), 'hex'), 'received')`,
      [foreignCapture, OTHER_TENANT, `${OTHER_TENANT}/originals/test/${foreignCapture}`],
    );
    // WORKER has no membership in OTHER_TENANT — `withTenantAs` refuses
    // before any row is visible (a `NotAMemberError`, not an `HttpException`),
    // which is the RLS boundary doing the isolating rather than an `if` in
    // this handler that could be gotten wrong. Whatever shape it throws, it
    // must NOT be the retryable `document_not_ready` 409: a stranger's
    // capture id is not "come back later", it is "no".
    let caught: unknown;
    try {
      await controller.patch(user, OTHER_TENANT, foreignCapture, {
        edits: { 'totals.payable': '1.00' },
      } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeTruthy();
    expect((caught as { response?: { error?: string } }).response?.error).not.toBe('document_not_ready');

    await admin.query('delete from captures where id = $1', [foreignCapture]);
  });

  it('the 409 refusal is not vacuous — verified by breaking it', async () => {
    // Hard rule: a guard nobody has seen fail is not known to guard anything.
    // This does not edit the handler; it proves the ASSERTION distinguishes
    // states, by comparing the not-ready refusal against the same capture
    // once a document exists — the exact transition case 1→2 depends on.
    const capture = await makeCapture();

    let before: unknown;
    try {
      await controller.patch(user, TENANT, capture, { edits: { 'totals.payable': '9.00' } } as never);
    } catch (error) {
      before = error;
    }
    expect((before as { status?: number }).status).toBe(409);

    await saveExtraction(WORKER, TENANT, capture, reading(), META, null);

    // Now it must NOT throw 409 — the same capture id, the only thing that
    // changed is a document now exists.
    const after = await controller.patch(user, TENANT, capture, {
      edits: { 'totals.payable': '9.00' },
    } as never);
    expect((after as { payableAmount: string }).payableAmount).toBe('9.0000');
  });
});
