import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import type { ValidatedExtraction } from '../extraction/types.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import { SummariesController } from './summaries.controller.js';

/**
 * Workspace totals are in ONE currency. Rp 70,900 + Rp 20 in an AUD household
 * once showed as "$70,920.00": receipts in a currency other than the
 * workspace's were summed into its total.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const AUD_WS = 'd0d0d0d0-0000-4000-8000-0000000000f1';
const IDR_WS = 'd0d0d0d0-0000-4000-8000-0000000000f2';
const WORKER = 'd0d0d0d0-0000-4000-8000-0000000000f3';
const OWNER = 'd0d0d0d0-0000-4000-8000-0000000000f4';

const f = <T>(value: T | null) => ({ value, confidence: 0.99 });
const today = new Date().toISOString().slice(0, 10);

function receipt(n: string, currency: string, payable: string, date = today, supplier = 'Warung'): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('receipt' as const),
      saysTaxInvoice: f(false),
      documentNumber: f(n),
      issueDate: f(date),
      currency: f(currency),
      supplierName: f(supplier),
      supplierAbn: f(null),
      buyerIdentified: f(false),
      taxExclusiveAmount: f(null),
      taxAmount: f(null),
      payableAmount: f(payable),
      lines: [],
      notes: { legible: true, imageIssues: [], warnings: [] },
    },
    findings: [],
    complianceFailures: [],
    isTaxInvoice: false,
    belowTaxInvoiceThreshold: true,
    gstAtRisk: null,
    reviewStatus: 'auto_accepted',
    confidenceOverall: 0.99,
  } as ValidatedExtraction;
}

const META = { model: 'm', promptVersion: 'test', latencyMs: 1, inputTokens: 1, outputTokens: 1, raw: '{}' };
const owner = { userId: OWNER, email: 'o@sum.test', displayName: 'Owner', initials: 'O', emailVerified: true };

describeIfDb('GET /v1/personal: totals never mix currencies', () => {
  let admin: Client;
  let worker: WorkerDb;
  const controller = new SummariesController();

  async function addDoc(tenant: string, n: string, currency: string, payable: string, date?: string, supplier?: string) {
    const capture = randomUUID();
    await withTenantAs(getDb(), OWNER, tenant, (tx) =>
      tx.execute(sql`
        insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                              original_byte_size, original_sha256, status)
        values (${capture}, ${tenant}, ${OWNER}, ${`${tenant}/originals/test/${capture}`}, 'image/png',
                1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received')
      `),
    );
    await saveExtraction(worker.actor, tenant, capture, receipt(n, currency, payable, date, supplier), META, null);
  }

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: AUD_WS,
      name: 'Summaries AUD household',
      users: [{ id: OWNER, role: 'owner', subject: 'test|sum-owner', email: 'o@sum.test', displayName: 'Owner' }],
      serviceUsers: [{ id: WORKER, subject: 'test|sum-worker', email: 'w@sum.test', displayName: 'Worker' }],
    });
    await admin.query(`insert into tenants (id, name) values ($1, 'Summaries IDR household')`, [IDR_WS]);
    await admin.query(`insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [IDR_WS, OWNER]);
    await admin.query(
      `update tenants set kind = 'personal', abn = NULL, gst_registered = false where id = any($1)`,
      [[AUD_WS, IDR_WS]],
    );
    await admin.query(`update tenants set country = 'ID', base_currency = 'IDR' where id = $1`, [IDR_WS]);
    worker = openWorkerDb(WORKER);

    await addDoc(AUD_WS, 'A-1', 'AUD', '12.50');
    await addDoc(AUD_WS, 'A-2', 'IDR', '70900');
    await addDoc(AUD_WS, 'A-3', 'IDR', '20');
    // Last year's: it must not keep a "not counted" note on this month.
    await addDoc(AUD_WS, 'A-old', 'IDR', '5000', '2020-01-01');
    // A rupiah subscription 3-5 months back: recurring, but outside this
    // month, this quarter and the analytics window, so no other figure moves.
    for (const k of [3, 4, 5]) {
      const d = new Date(new Date().getFullYear(), new Date().getMonth() - k, 5);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-05`;
      await addDoc(AUD_WS, `N-${k}`, 'IDR', '186000', date, 'Netflix');
    }
    await addDoc(IDR_WS, 'I-1', 'IDR', '70900');
    await addDoc(IDR_WS, 'I-2', 'IDR', '20');
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, IDR_WS, []);
    await admin.query('DELETE FROM tenants WHERE id = $1', [IDR_WS]);
    await wipeTenant(admin, AUD_WS, [WORKER, OWNER]);
    await admin.end();
    await worker.pool.end();
    await closeDb();
  });

  it('an IDR workspace totals its IDR receipts', async () => {
    const s = await controller.personal(owner, IDR_WS);
    expect(s.spentThisMonth).toBe('70920.0000');
    expect(s.receiptCount).toBe(2);
    expect(s.foreignCurrencyCount).toBe(0);
  });

  it("an AUD workspace leaves IDR receipts out of its total and counts this month's", async () => {
    const s = await controller.personal(owner, AUD_WS);
    expect(s.spentThisMonth).toBe('12.5000');
    expect(s.receiptCount).toBe(1);
    expect(s.foreignCurrencyCount).toBe(2);
  });

  it('analytics and the overview total the IDR receipts apart, per currency, in the period only', async () => {
    const a = await controller.analytics(owner, AUD_WS, 'quarter');
    expect(a.total).toBe('12.5000');
    expect(a.otherCurrencies).toEqual([{ currency: 'IDR', total: '70920.0000', count: 2 }]);
    const o = await controller.overview(owner, AUD_WS);
    expect(o.otherCurrencies).toEqual([{ currency: 'IDR', total: '70920.0000', count: 2 }]);
    expect((await controller.analytics(owner, IDR_WS, 'quarter')).otherCurrencies).toEqual([]);
  });

  it('recurring keeps old clients on workspace-currency rows; other currencies only on request', async () => {
    // A build from before 1.30.e adds every row into one AUD total: it must not see the rupiah one.
    expect(await controller.recurring(owner, AUD_WS)).toEqual([]);
    const all = await controller.recurring(owner, AUD_WS, '1');
    expect(all.map((r) => [r.merchant, r.currency, r.typicalAmount])).toEqual([['Netflix', 'IDR', '186000.0000']]);
  });
});
