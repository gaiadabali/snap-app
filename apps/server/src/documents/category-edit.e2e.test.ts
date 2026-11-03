import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { CaptureDocumentController } from '../captures/capture-document.controller.js';
import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import type { ValidatedExtraction } from '../extraction/types.js';

/**
 * The category edit on a correction, through the controller, against real
 * Postgres as the application role: unknown names are ignored, role and tenant
 * are enforced, and clearing a category is a person's choice that supplier
 * memory respects.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-0000000000e1';
const OTHER = 'd0d0d0d0-0000-4000-8000-0000000000e2';
const WORKER = 'd0d0d0d0-0000-4000-8000-0000000000e3';
const OWNER = 'd0d0d0d0-0000-4000-8000-0000000000e4';
const READONLY = 'd0d0d0d0-0000-4000-8000-0000000000e5';
const TRAVEL = randomUUID();
const MEALS = randomUUID();
const FOREIGN = randomUUID();

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

function reading(documentNumber: string): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('tax_invoice' as const),
      saysTaxInvoice: f(true),
      documentNumber: f(documentNumber),
      issueDate: f('2026-08-14'),
      currency: f('AUD'),
      supplierName: f('Corner Store Pty Ltd'),
      supplierAbn: f('85129887341'),
      buyerIdentified: f(true),
      taxExclusiveAmount: f('100.00'),
      taxAmount: f('10.00'),
      payableAmount: f('110.00'),
      lines: [
        {
          description: f('Supplies'),
          quantity: f(1),
          unitPrice: f('110.00'),
          amount: f('110.00'),
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

const META = { model: 'm', promptVersion: 'test', latencyMs: 1, inputTokens: 1, outputTokens: 1, raw: '{}' };

const owner = { userId: OWNER, email: 'o@catedit.test', displayName: 'Owner', initials: 'O', emailVerified: true };
const readonly = { userId: READONLY, email: 'r@catedit.test', displayName: 'Ro', initials: 'R', emailVerified: true };

describeIfDb('PATCH /v1/captures/:id/document: category edits', () => {
  let admin: Client;
  let worker: WorkerDb;
  const controller = new CaptureDocumentController();

  const q = <T extends Record<string, unknown> = Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    withTenantAs(getDb(), OWNER, TENANT, (tx) => tx.execute<T>(text));

  /** A capture with an extracted document; optionally already filed by a person. */
  async function makeDoc(documentNumber: string, categoryId: string | null = null) {
    const capture = randomUUID();
    await q(sql`
      insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                            original_byte_size, original_sha256, status)
      values (${capture}, ${TENANT}, ${OWNER}, ${`${TENANT}/originals/test/${capture}`}, 'image/png',
              1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received')
    `);
    const { documentId } = await saveExtraction(worker.actor, TENANT, capture, reading(documentNumber), META, null);
    if (categoryId) {
      await admin.query(`update documents set category_id = $1, category_source = 'user' where id = $2`, [
        categoryId,
        documentId,
      ]);
    }
    return { capture, documentId };
  }

  const row = async (documentId: string) =>
    (
      await q<{ category_id: string | null; category_source: string | null; payable_amount: string }>(sql`
        select category_id, category_source, payable_amount::text from documents where id = ${documentId}
      `)
    ).rows[0]!;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Category edit e2e co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|ce-owner', email: 'o@catedit.test', displayName: 'Owner' },
        { id: READONLY, role: 'readonly', subject: 'test|ce-ro', email: 'r@catedit.test', displayName: 'Ro' },
      ],
      serviceUsers: [{ id: WORKER, subject: 'test|ce-worker', email: 'w@catedit.test', displayName: 'Worker' }],
    });
    worker = openWorkerDb(WORKER);
    await admin.query(`insert into tenants (id, name) values ($1, 'Category edit other co') on conflict do nothing`, [OTHER]);
    await admin.query(
      `insert into categories (id, tenant_id, name) values ($1, $3, 'Travel'), ($2, $3, 'Meals')`,
      [TRAVEL, MEALS, TENANT],
    );
    await admin.query(`insert into categories (id, tenant_id, name) values ($1, $2, 'Foreign')`, [FOREIGN, OTHER]);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await admin.query('DELETE FROM categories WHERE tenant_id = $1', [OTHER]);
    await admin.query('DELETE FROM tenants WHERE id = $1', [OTHER]);
    await wipeTenant(admin, TENANT, [WORKER, OWNER, READONLY]);
    await admin.end();
    await worker.pool.end();
    await closeDb();
  });

  it('an unknown category name saves the other edits and leaves the category alone', async () => {
    const { capture, documentId } = await makeDoc('CE-1', TRAVEL);
    await controller.patch(owner, TENANT, capture, {
      edits: { 'header.category': 'Tolls', 'totals.payable': '55.00' },
    } as never);
    const after = await row(documentId);
    expect(after.payable_amount).toBe('55.0000');
    expect(after.category_id).toBe(TRAVEL);
    expect(after.category_source).toBe('user');
  });

  it('a read-only member is refused (403) a category change, by id and by name; an owner is allowed', async () => {
    // Supplier memory may already have filed it under Travel (from CE-1).
    const { capture, documentId } = await makeDoc('CE-2');
    const before = (await row(documentId)).category_id;
    for (const edits of [{ 'header.category_id': MEALS }, { 'header.category': 'Meals' }]) {
      await expect(controller.patch(readonly, TENANT, capture, { edits } as never)).rejects.toMatchObject({
        status: 403,
      });
    }
    expect((await row(documentId)).category_id).toBe(before);

    await controller.patch(owner, TENANT, capture, { edits: { 'header.category_id': MEALS } } as never);
    expect((await row(documentId)).category_id).toBe(MEALS);
  });

  it("another workspace's category id is a 400 and changes nothing", async () => {
    const { capture, documentId } = await makeDoc('CE-3', TRAVEL);
    await expect(
      controller.patch(owner, TENANT, capture, { edits: { 'header.category_id': FOREIGN } } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect((await row(documentId)).category_id).toBe(TRAVEL);
  });

  it('clearing a category is a person\'s choice: supplier memory does not refill it on re-extraction', async () => {
    // A is filed by a person; B (same supplier ABN) picks it up by memory.
    await makeDoc('CE-4a', TRAVEL);
    const b = await makeDoc('CE-4b');
    expect((await row(b.documentId)).category_id).toBe(TRAVEL);
    expect((await row(b.documentId)).category_source).toBe('supplier');

    await controller.patch(owner, TENANT, b.capture, { edits: { 'header.category_id': null } } as never);
    const cleared = await row(b.documentId);
    expect(cleared.category_id).toBeNull();
    expect(cleared.category_source).toBe('user');

    await saveExtraction(worker.actor, TENANT, b.capture, reading('CE-4b'), META, null);
    const again = await row(b.documentId);
    expect(again.category_id).toBeNull();
    expect(again.category_source).toBe('user');
  });
});
