import { randomUUID } from 'node:crypto';

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import { deductionTotals } from '../deductions/deductions.repo.js';
import type { ValidatedExtraction } from '../extraction/types.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import { DocumentsController } from './documents.controller.js';

/**
 * Filing single lines of a receipt as work expenses (PATCH /v1/documents/:id/lines/categories),
 * through the controller against real Postgres as the application role: what counts, who may,
 * which categories, and that a filing survives a line edit and a re-reading.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-0000000000a1';
const OTHER = 'd0d0d0d0-0000-4000-8000-0000000000a2';
const BIZ = 'd0d0d0d0-0000-4000-8000-0000000000a3';
const WORKER = 'd0d0d0d0-0000-4000-8000-0000000000a4';
const OWNER = 'd0d0d0d0-0000-4000-8000-0000000000a5';
const READONLY = 'd0d0d0d0-0000-4000-8000-0000000000a6';
const BIZ_OWNER = 'd0d0d0d0-0000-4000-8000-0000000000a7';
const TOOLS = randomUUID();
const LAUNDRY = randomUUID();
const GROCERIES = randomUUID();
const OTHER_TOOLS = randomUUID();
const BIZ_TOOLS = randomUUID();

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });
const item = (description: string, amount: string, gstFree = false) => ({
  description: f(description), quantity: f(1), unitPrice: f(amount), amount: f(amount), gstFree: f(gstFree),
});

/** A supermarket docket: GST-free food and one taxable work item, lines printed with GST in them. */
function docket(documentNumber: string, hammer = 'Hammer 450g'): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('tax_invoice' as const),
      saysTaxInvoice: f(true),
      documentNumber: f(documentNumber),
      issueDate: f('2025-09-01'),
      currency: f('AUD'),
      supplierName: f(`Corner Store ${documentNumber}`),
      supplierAbn: f('85129887341'),
      buyerIdentified: f(false),
      taxExclusiveAmount: f('62.03'),
      taxAmount: f('2.27'),
      payableAmount: f('64.30'),
      lines: [item('Milk 2L', '3.10', true), item(hammer, '25.00'), item('Fruit and veg', '36.20', true)],
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
const owner = { userId: OWNER, email: 'o@lines.test', displayName: 'Owner', initials: 'O', emailVerified: true } as never;
const readonly = { userId: READONLY, email: 'r@lines.test', displayName: 'Ro', initials: 'R', emailVerified: true } as never;
const bizOwner = { userId: BIZ_OWNER, email: 'b@lines.test', displayName: 'Biz', initials: 'B', emailVerified: true } as never;

describeIfDb('PATCH /v1/documents/:id/lines/categories: work lines on a receipt', () => {
  let admin: Client;
  let worker: WorkerDb;
  const docs = new DocumentsController();

  async function makeDoc(documentNumber: string, tenant = TENANT, reading = docket(documentNumber)) {
    const capture = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/png', 1024, decode($5, 'hex'), 'received')`,
      [capture, tenant, tenant === BIZ ? BIZ_OWNER : OWNER, `${tenant}/originals/test/${capture}`,
       randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)],
    );
    const { documentId } = await saveExtraction(worker.actor, tenant, capture, reading, META, null);
    return { capture, documentId };
  }

  const lineCats = async (documentId: string) =>
    (await admin.query<{ line_number: number; category_id: string | null }>(
      `select line_number, category_id from document_lines where document_id = $1 order by line_number`, [documentId],
    )).rows.map((r) => r.category_id);
  const tools = async () => (await deductionTotals(OWNER, TENANT, 2025)).items.find((i) => i.itemId === 'tools')?.workCents ?? 0n;

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Work lines e2e',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|wl-owner', email: 'o@lines.test', displayName: 'Owner' },
        { id: READONLY, role: 'readonly', subject: 'test|wl-ro', email: 'r@lines.test', displayName: 'Ro' },
      ],
      serviceUsers: [{ id: WORKER, subject: 'test|wl-worker', email: 'w@lines.test', displayName: 'Worker' }],
    });
    worker = openWorkerDb(WORKER);
    await admin.query(`update tenants set kind = 'personal', abn = null, gst_registered = false where id = $1`, [TENANT]);
    for (const [t, k] of [[OTHER, 'personal'], [BIZ, 'business']] as const) {
      await admin.query(`insert into tenants (id, name, kind) values ($1, $2, $3) on conflict do nothing`, [t, `wl ${k}`, k]);
    }
    await admin.query(`insert into users (id, subject, email, display_name) values ($1, 'test|wl-biz', 'b@lines.test', 'Biz') on conflict do nothing`, [BIZ_OWNER]);
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`, [BIZ, BIZ_OWNER]);
    const cat = (id: string, t: string, name: string, label: string | null, itemId: string | null) =>
      admin.query(`insert into categories (id, tenant_id, name, ato_deduction_code, engine_row_id) values ($1,$2,$3,$4,$5)`, [id, t, name, label, itemId]);
    await cat(TOOLS, TENANT, 'Work tools and equipment', 'D5', 'tools');
    await cat(LAUNDRY, TENANT, 'Work clothing: laundry', 'D3', 'washPowder');
    await cat(GROCERIES, TENANT, 'Groceries', null, null);
    await cat(OTHER_TOOLS, OTHER, 'Work tools and equipment', 'D5', 'tools');
    await cat(BIZ_TOOLS, BIZ, 'Tools', 'D5', 'tools');
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const t of [OTHER, BIZ]) await wipeTenant(admin, t);
    await wipeTenant(admin, TENANT, [WORKER, OWNER, READONLY, BIZ_OWNER]);
    await admin.end();
    await worker.pool.end();
    await closeDb();
  });

  it('files the hammer as a work expense: counted as printed (GST in it), the rest stays out, the verdict stays', async () => {
    const { documentId } = await makeDoc('WL-1');
    await admin.query(`update documents set category_id = $1, category_source = 'user' where id = $2`, [GROCERIES, documentId]);
    const verdict = { failures: ['buyer_abn_required_over_1000'], findings: [{ code: 'kept', field: 'lines', severity: 'note', message: 'x' }] };
    await admin.query(`update documents set ato_compliance = $1::jsonb where id = $2`, [JSON.stringify(verdict), documentId]);
    const before = await tools();
    const v0 = (await admin.query<{ version: number }>(`select version from documents where id = $1`, [documentId])).rows[0]!.version;

    const wire = await docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId: TOOLS }], version: v0 } as never);
    expect(wire.lines.map((l) => [l.categoryId, l.category])).toEqual([[null, null], [TOOLS, 'Work tools and equipment'], [null, null]]);
    expect(wire.categoryId).toBe(GROCERIES);
    expect(await tools()).toBe(before + 2500n);

    const row = (await admin.query<{ ato_compliance: unknown; payable_amount: string; version: number }>(
      `select ato_compliance, payable_amount::text, version from documents where id = $1`, [documentId],
    )).rows[0]!;
    expect(row.ato_compliance).toEqual(verdict);
    expect(row.payable_amount).toBe('64.3000');
    expect(row.version).toBeGreaterThan(v0);

    // A stale version is a 409 and changes nothing.
    await expect(
      docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId: null }], version: v0 } as never),
    ).rejects.toMatchObject({ status: 409 });
    expect(await lineCats(documentId)).toEqual([null, TOOLS, null]);

    // Back with the receipt.
    await docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId: null }] } as never);
    expect(await lineCats(documentId)).toEqual([null, null, null]);
    expect(await tools()).toBe(before);
  });

  it('a read-only member is refused (403); only work and tax categories of this personal space are accepted (400)', async () => {
    const { documentId } = await makeDoc('WL-2');
    await expect(docs.lineCategories(readonly, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId: TOOLS }] } as never))
      .rejects.toMatchObject({ status: 403 });
    for (const categoryId of [GROCERIES, OTHER_TOOLS, BIZ_TOOLS, 'not-a-uuid', randomUUID()]) {
      await expect(docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId }] } as never))
        .rejects.toMatchObject({ status: 400 });
    }
    await expect(docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 9, categoryId: TOOLS }] } as never))
      .rejects.toMatchObject({ status: 400 });
    await expect(docs.lineCategories(owner, TENANT, randomUUID(), { lines: [{ lineNumber: 1, categoryId: TOOLS }] } as never))
      .rejects.toMatchObject({ status: 404 });
    expect(await lineCats(documentId)).toEqual([null, null, null]);
  });

  it('a business space files no lines for a tax return, even in a labelled category', async () => {
    const capture = randomUUID();
    const documentId = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/png', 1, decode($5, 'hex'), 'received')`,
      [capture, BIZ, BIZ_OWNER, `${BIZ}/o/${capture}`, randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)],
    );
    await admin.query(`insert into documents (id, tenant_id, capture_id, issue_date, payable_amount) values ($1, $2, $3, '2025-09-01', '25.00')`, [documentId, BIZ, capture]);
    await admin.query(
      `insert into document_lines (id, tenant_id, document_id, line_number, line_net_amount) values ($1, $2, $3, 2, '25.00')`,
      [randomUUID(), BIZ, documentId],
    );
    await expect(docs.lineCategories(bizOwner, BIZ, documentId, { lines: [{ lineNumber: 2, categoryId: BIZ_TOOLS }] } as never))
      .rejects.toMatchObject({ status: 400 });
  });

  it('a line edit keeps the filing (old clients send no categoryId); an explicit one wins', async () => {
    const { documentId } = await makeDoc('WL-4');
    await docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId: TOOLS }] } as never);
    const line = (description: string, amount: string, gstFree = false) => ({ description, quantity: 1, unitPrice: amount, amount, gstFree });

    // The milk is removed and the fruit corrected: the hammer moves to line 1 and stays filed.
    await docs.lines(owner, TENANT, documentId, { lines: [line('Hammer 450g', '25.00'), line('Fruit and veg', '39.30', true)] } as never);
    expect(await lineCats(documentId)).toEqual([TOOLS, null]);

    // As the review screens send them back: whole, with the filing on each line.
    await docs.lines(owner, TENANT, documentId, {
      lines: [
        { ...line('Hammer 450g', '25.00'), lineNumber: 1, category: 'Work tools and equipment', categoryId: null, confidence: 1 },
        { ...line('Fruit and veg', '39.30', true), lineNumber: 2, category: null, categoryId: LAUNDRY, confidence: 1 },
      ],
    } as never);
    expect(await lineCats(documentId)).toEqual([null, LAUNDRY]);

    await expect(docs.lines(owner, TENANT, documentId, { lines: [{ ...line('Hammer', '25.00'), categoryId: GROCERIES }] } as never))
      .rejects.toMatchObject({ status: 400 });
    expect(await lineCats(documentId)).toEqual([null, LAUNDRY]);
  });

  it('a re-reading keeps a filed line that reads the same, and unfiles one that does not', async () => {
    const { capture, documentId } = await makeDoc('WL-5');
    await docs.lineCategories(owner, TENANT, documentId, { lines: [{ lineNumber: 2, categoryId: TOOLS }] } as never);
    await saveExtraction(worker.actor, TENANT, capture, docket('WL-5'), META, null);
    expect(await lineCats(documentId)).toEqual([null, TOOLS, null]);
    await saveExtraction(worker.actor, TENANT, capture, docket('WL-5', 'Claw hammer'), META, null);
    expect(await lineCats(documentId)).toEqual([null, null, null]);
  });
});
