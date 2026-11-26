import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AU_2026 } from '@snap/tax-rules';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ValidatedExtraction } from '../extraction/types.js';
import { closeDb } from '../db.js';
import { saveExtraction, type TenantRow } from '../repo.js';
import { makeAccount, provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import { assessmentDate, availableRules, rulesStampOf, tenantRulesFor, todayIso } from './taxrules.repo.js';

/**
 * PER-YEAR TAX RULES, AGAINST REAL POSTGRES.
 *
 * An Australian personal workspace stores `au-2026` (every email sign-up since
 * build plan 1.38). A receipt dated 15 March 2026 belongs to 2025–26 — the year
 * Australians are lodging for now — so it must be assessed under `au-2025`,
 * and what is stored about it must say `2025.1.0`, or it cannot be re-derived
 * once more years exist (README principle 2).
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'e7e7e7e7-0000-4000-8000-000000000001';
const OWNER = 'e7e7e7e7-0000-4000-8000-0000000000a1';
const WORKER = 'e7e7e7e7-0000-4000-8000-0000000000a2';

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

/** A March 2026 grocery docket, as the validators would hand it on. */
function marchReceipt(): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('receipt' as const),
      saysTaxInvoice: f(true),
      documentNumber: f(null),
      issueDate: f('2026-03-15'),
      currency: f('AUD'),
      supplierName: f('Officeworks Richmond'),
      supplierAbn: f(null),
      buyerIdentified: f(false),
      taxExclusiveAmount: f('100.00'),
      taxAmount: f('10.00'),
      payableAmount: f('110.00'),
      roundingAmount: f('0.00'),
      dueDate: f(null),
      payment: { method: f('VISA'), cardLast4: f('4242'), cardBrand: f('VISA') },
      lines: [
        { description: f('Desk lamp'), quantity: f(1), unitPrice: f('110.00'), amount: f('110.00'), gstFree: f(false) },
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

describeIfDb('per-year tax rules (AU personal, au-2026 installed)', () => {
  let admin: Client;
  let worker: WorkerDb;
  let app: NestFastifyApplication;
  let issueSession: (userId: string) => string;

  const auth = () => ({ authorization: `Bearer ${issueSession(OWNER)}`, 'x-workspace-id': TENANT });

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Tax years household',
      users: [{ id: OWNER, role: 'owner' }],
      serviceUsers: [{ id: WORKER, subject: 'test|tax-years-worker', email: 'worker@tax-years.test', displayName: 'Extraction Worker' }],
    });
    // Personal and Australian, with the rule set an email sign-up stores.
    await admin.query(
      `update tenants set kind = 'personal', abn = NULL, gst_registered = false,
              country = 'AU', base_currency = 'AUD', financial_year_start_month = 7,
              tax_rules_id = 'au-2026', tax_rules_version = $2
        where id = $1`,
      [TENANT, AU_2026.version],
    );
    worker = openWorkerDb(WORKER);

    issueSession = await (await import('../test-support/sessions.js')).openSessions(OWNER);
    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [OWNER, WORKER]);
    await admin.end();
    await worker?.pool.end();
    await app.close();
    await closeDb();
  });

  async function tenantRow(): Promise<TenantRow> {
    const { rows } = await admin.query(`select * from tenants where id = $1`, [TENANT]);
    return rows[0] as TenantRow;
  }

  it('stores the extraction run of a 2026-03-15 receipt stamped au-2025 / 2025.1.0', async () => {
    const captureId = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status, captured_at)
       values ($1, $2, $3, $4, 'image/png', 1024, decode($5, 'hex'), 'received', '2026-11-20T02:00:00Z')`,
      [captureId, TENANT, OWNER, `${TENANT}/originals/test/${captureId}`, randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)],
    );

    // Exactly what worker.ts does once the model has returned the date: the
    // receipt's own date first, the capture's (20 November, 2026–27) second.
    const tenantRules = await tenantRulesFor(await tenantRow());
    const reading = marchReceipt();
    const stamp = rulesStampOf(tenantRules, assessmentDate(reading.extraction.issueDate.value, '2026-11-20'));

    await saveExtraction(
      worker.actor,
      TENANT,
      captureId,
      reading,
      { model: 'gemma4:31b', promptVersion: 'test', latencyMs: 1, inputTokens: 1, outputTokens: 1, raw: '{}', rules: stamp },
      // The Australian reader: an AU workspace's reader rule set is null.
      null,
    );

    const { rows } = await admin.query(
      `select validator_report from extraction_runs where capture_id = $1 and status = 'succeeded'`,
      [captureId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].validator_report).toEqual({
      rules: { rulesId: 'au-2025', rulesVersion: '2025.1.0', onDate: '2026-03-15', match: 'exact', reader: 'au_builtin' },
    });
  });

  it('reports March 2026 spending under au-2025 and September 2026 under au-2026', async () => {
    const expense = await makeAccount(admin, TENANT, '6-1200', 'Household', 'expense');
    const bank = await makeAccount(admin, TENANT, '1-1100', 'Everyday account', 'asset');
    const gst = (await admin.query(`select id from tax_codes where tenant_id is null and country = 'AU' and code = 'GST'`)).rows[0]
      .id as string;

    const post = async (date: string) => {
      const txnId = randomUUID();
      await admin.query('begin');
      await admin.query(
        `insert into transactions (id, tenant_id, txn_date, status, source, posted_at)
         values ($1, $2, $3, 'posted', 'manual', now())`,
        [txnId, TENANT, date],
      );
      await admin.query(
        `insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount)
         values ($1, $2, $3, 1, $4, 110, $5, 10), ($6, $2, $3, 2, $7, -110, null, 0)`,
        [randomUUID(), TENANT, txnId, expense, gst, randomUUID(), bank],
      );
      await admin.query('commit');
    };
    await post('2026-03-15');
    await post('2026-09-10');

    const march = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules/consumption-tax?from=2026-03-01&to=2026-03-31',
      headers: auth(),
    });
    expect(march.statusCode).toBe(200);
    expect(march.json()).toMatchObject({ rulesId: 'au-2025', rulesVersion: '2025.1.0', taxName: 'GST', taxPaid: '10.00' });

    const september = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules/consumption-tax?from=2026-09-01&to=2026-09-30',
      headers: auth(),
    });
    expect(september.statusCode).toBe(200);
    expect(september.json()).toMatchObject({ rulesId: 'au-2026', rulesVersion: '2026.1.0', taxPaid: '10.00' });
  });

  it('settings show the year covering today, and the catalogue offers one Australia', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tax-rules', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const current = availableRules(todayIso());
    const au = current.find((r) => r.country === 'AU')!;
    expect(body).toMatchObject({ rulesId: au.rulesId, rulesVersion: au.version, taxYear: au.taxYear, problem: null });
    expect(body.available.filter((r: { country: string }) => r.country === 'AU')).toHaveLength(1);

    // Nothing was reinstalled: the workspace still stores what it chose.
    const { rows } = await admin.query(`select tax_rules_id, tax_rules_version from tenants where id = $1`, [TENANT]);
    expect(rows[0]).toEqual({ tax_rules_id: 'au-2026', tax_rules_version: AU_2026.version });
  });
});
