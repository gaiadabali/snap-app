import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { getPointBalance, listPointLedger } from './points.repo.js';
import type { ValidatedExtraction } from '../extraction/types.js';

/**
 * Proves the wiring, not just the mechanism: a real `saveExtraction` call —
 * the exact function the worker (`worker.ts`) calls on a successful
 * extraction — results in one point for the person who captured the receipt,
 * and a second run over the SAME capture (re-extraction, `docs/PLAN.md`'s
 * second principle) never pays a second one.
 *
 * `points.repo.test.ts` covers `awardScanPoint` itself in isolation; this
 * file is the one place that proves `saveExtraction` actually calls it, with
 * the right capture, and attributed to the right person — `uploaded_by`, not
 * the worker's own service identity.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'de200000-0000-4000-8000-000000000001';
const WORKER = 'de200000-0000-4000-8000-0000000000a1';
const UPLOADER = 'de200000-0000-4000-8000-0000000000a2';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(text: ReturnType<typeof sql>) =>
  withTenantAs(getDb(), WORKER, TENANT, (tx) => tx.execute<T>(text));

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

function reading(payable = '110.00'): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('tax_invoice' as const),
      saysTaxInvoice: f(true),
      documentNumber: f('RX-SP-1'),
      issueDate: f('2026-08-14'),
      currency: f('AUD'),
      supplierName: f('Scan Point Test Supplier'),
      supplierAbn: f('85129887341'),
      buyerIdentified: f(true),
      taxExclusiveAmount: f('100.00'),
      taxAmount: f('10.00'),
      payableAmount: f(payable),
      lines: [
        {
          description: f('Freight'),
          quantity: f(1),
          unitPrice: f(payable),
          amount: f(payable),
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

/** A capture UPLOADED BY the person who should earn the point — not the worker. */
async function makeCapture(): Promise<string> {
  const id = randomUUID();
  await q(sql`
    insert into captures (
      id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
      original_byte_size, original_sha256, status
    ) values (
      ${id}, ${TENANT}, ${UPLOADER}, ${`${TENANT}/originals/test/${id}`}, 'image/png',
      1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received'
    )
  `);
  return id;
}

describeIfDb('saveExtraction awards a scan point', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Scan point pipeline test co',
      users: [
        { id: WORKER, role: 'member', subject: 'test|scanpoint-worker', email: 'worker@scanpoint.test' },
        { id: UPLOADER, role: 'owner', subject: 'test|scanpoint-uploader', email: 'uploader@scanpoint.test' },
      ],
    });
  });

  afterAll(async () => {
    await admin.query('DELETE FROM point_ledger WHERE user_id = $1', [UPLOADER]);
    await wipeTenant(admin, TENANT, [WORKER, UPLOADER]);
    await admin.end();
    await closeDb();
  });

  it('credits the CAPTURING user, not the worker, exactly once', async () => {
    const capture = await makeCapture();
    const before = await getPointBalance(UPLOADER);

    await saveExtraction(WORKER, TENANT, capture, reading(), META);

    expect(await getPointBalance(UPLOADER)).toBe(before + 1);
    expect(await getPointBalance(WORKER)).toBe(0); // never the worker's own identity

    const ledger = await listPointLedger(UPLOADER);
    expect(ledger.find((r) => r.ref === capture)).toMatchObject({ reason: 'scan', delta: 1 });
  });

  it('a re-extraction of the SAME capture does not pay a second point', async () => {
    const capture = await makeCapture();
    await saveExtraction(WORKER, TENANT, capture, reading('110.00'), META);
    const afterFirst = await getPointBalance(UPLOADER);

    // A better model re-reads the same receipt later — same capture id.
    await saveExtraction(WORKER, TENANT, capture, reading('120.00'), META);

    expect(await getPointBalance(UPLOADER)).toBe(afterFirst);
    const ledger = await listPointLedger(UPLOADER);
    expect(ledger.filter((r) => r.ref === capture)).toHaveLength(1);
  });
});
