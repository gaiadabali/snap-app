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
 * Proves Snap Apps points are retired (`docs/ECOSYSTEM.md` D33): a real
 * `saveExtraction` call — the exact function the worker (`worker.ts`) calls on
 * a successful extraction — writes NO `point_ledger` row, for the person who
 * captured the receipt or anyone else, on the first extraction or a
 * re-extraction. YourTal points are earned through the outbox instead
 * (`yourtal-outbox.e2e.test.ts`).
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

describeIfDb('saveExtraction writes no Snap Apps point', () => {
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

  const ledgerRows = async (): Promise<number> => {
    const r = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM point_ledger WHERE user_id = ANY($1::uuid[])',
      [[UPLOADER, WORKER]],
    );
    return Number(r.rows[0]!.n);
  };

  it('a confirmed scan writes no point_ledger row for the capturing user or the worker', async () => {
    const capture = await makeCapture();
    const before = await ledgerRows();

    await saveExtraction(WORKER, TENANT, capture, reading(), META, null);

    expect(await ledgerRows()).toBe(before);
    expect(await getPointBalance(UPLOADER)).toBe(0);
    expect(await getPointBalance(WORKER)).toBe(0);
    expect(await listPointLedger(UPLOADER)).toEqual([]);
  });

  it('a re-extraction of the same capture writes none either', async () => {
    const capture = await makeCapture();
    await saveExtraction(WORKER, TENANT, capture, reading('110.00'), META, null);
    await saveExtraction(WORKER, TENANT, capture, reading('120.00'), META, null);

    expect(await ledgerRows()).toBe(0);
  });
});
