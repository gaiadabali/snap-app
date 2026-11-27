import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenantAs } from '@snap/db';
import type { TaxRules } from '@snap/tax-rules';

import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import type { SupplierAddress, ValidatedExtraction } from './types.js';

/**
 * Plan task 9.5.h: where a receipt was bought, stored on the supplier
 * (`parties.address_line1 / city / state / postcode`) by `saveExtraction`.
 *
 * Against real Postgres as the worker, through RLS, like `card-persistence.e2e
 * .test.ts`. Skips cleanly without `DATABASE_URL`. The fixtures here are built
 * BY HAND, bypassing `parseExtraction`, so these tests prove the write
 * boundary's own defences (re-normalising, fill-only-empty, same-place), not a
 * restatement of the parser tests in `merchant-address.test.ts`.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c5c5c5c5-0000-4000-8000-000000000001';
const WORKER = 'c5c5c5c5-0000-4000-8000-0000000000a1';
const OWNER = 'c5c5c5c5-0000-4000-8000-0000000000a2';

const q = <T extends Record<string, unknown> = Record<string, unknown>>(text: ReturnType<typeof sql>) =>
  withTenantAs(getDb(), OWNER, TENANT, (tx) => tx.execute<T>(text));

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });

type Addr = { line1?: string | null; city?: string | null; state?: string | null; postcode?: string | null };

const address = (a: Addr | null): SupplierAddress | undefined =>
  a == null
    ? undefined
    : {
        line1: f(a.line1 ?? null),
        city: f(a.city ?? null),
        state: f(a.state ?? null),
        postcode: f(a.postcode ?? null),
      };

function reading(supplier: string, a: Addr | null): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('receipt' as const),
      saysTaxInvoice: f(false),
      documentNumber: f(null),
      issueDate: f('2026-09-10'),
      currency: f('AUD'),
      supplierName: f(supplier),
      supplierAbn: f(null),
      supplierAddress: address(a),
      buyerIdentified: f(false),
      taxExclusiveAmount: f('76.55'),
      taxAmount: f('7.65'),
      payableAmount: f('84.20'),
      roundingAmount: f('0.00'),
      dueDate: f(null),
      payment: { method: f('VISA'), cardLast4: f('4417'), cardBrand: f('VISA') },
      lines: [
        { description: f('Item'), quantity: f(1), unitPrice: f('84.20'), amount: f('84.20'), gstFree: f(false) },
      ],
      notes: { legible: true, imageIssues: [], warnings: [] },
    },
    findings: [],
    complianceFailures: [],
    isTaxInvoice: false,
    belowTaxInvoiceThreshold: true,
    gstAtRisk: null,
    reviewStatus: 'auto_accepted',
    confidenceOverall: 0.99,
  };
}

const META = { model: 'gemma4:31b', promptVersion: 'test', latencyMs: 1, inputTokens: 1, outputTokens: 1, raw: '{}' };

async function makeCapture(): Promise<string> {
  const id = randomUUID();
  await q(sql`
    insert into captures (
      id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
      original_byte_size, original_sha256, status
    ) values (
      ${id}, ${TENANT}, ${OWNER}, ${`${TENANT}/originals/test/${id}`}, 'image/png',
      1024, decode(${randomUUID().replace(/-/g, '').repeat(2).slice(0, 64)}, 'hex'), 'received'
    )
  `);
  return id;
}

type PartyRow = { address_line1: string | null; city: string | null; state: string | null; postcode: string | null };

async function party(name: string): Promise<PartyRow> {
  const r = await q<PartyRow>(sql`
    select address_line1, city, state, postcode from parties
     where legal_name = ${name} and kind = 'supplier'
  `);
  expect(r.rows.length, `exactly one supplier called ${name}`).toBe(1);
  return r.rows[0]!;
}

describeIfDb('merchant location on the supplier (9.5.h)', () => {
  let admin: Client;
  let worker: WorkerDb;

  const save = async (supplier: string, a: Addr | null, rules: TaxRules | null = null) =>
    saveExtraction(worker.actor, TENANT, await makeCapture(), reading(supplier, a), META, rules);

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Merchant location test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|merchant-location-owner', email: 'owner@merchant-location.test' }],
      serviceUsers: [
        {
          id: WORKER,
          subject: 'test|merchant-location-worker',
          email: 'worker@merchant-location.test',
          displayName: 'Extraction Worker',
        },
      ],
    });
    worker = openWorkerDb(WORKER);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [WORKER, OWNER]);
    await admin.end();
    await worker.pool.end();
    await closeDb();
  });

  it('a scanned receipt records the merchant street, suburb, state and postcode', async () => {
    await save('Ampol Haymarket', { line1: '245 Parramatta Rd', city: 'Haymarket', state: 'NSW', postcode: '2000' });
    expect(await party('Ampol Haymarket')).toEqual({
      address_line1: '245 Parramatta Rd',
      city: 'Haymarket',
      state: 'NSW',
      postcode: '2000',
    });
  });

  it('a receipt with no address stores nothing', async () => {
    await save('Cash Only Kiosk', null);
    expect(await party('Cash Only Kiosk')).toEqual({ address_line1: null, city: null, state: null, postcode: null });
  });

  it('re-normalises at the write boundary: a hand-built bad postcode or full state name never lands raw', async () => {
    await save('Hand Built Cafe', { city: 'BONDI JUNCTION', state: 'New South Wales', postcode: '20220' });
    // Postcode refused (five digits); suburb title-cased; full state name mapped.
    expect(await party('Hand Built Cafe')).toEqual({ address_line1: null, city: 'Bondi Junction', state: 'NSW', postcode: null });
  });

  it('drops a state/postcode clash whole rather than store half a wrong pin', async () => {
    await save('Clash Pty Ltd', { line1: '12 Smith St', city: 'Richmond', state: 'NSW', postcode: '3121' });
    expect(await party('Clash Pty Ltd')).toEqual({ address_line1: null, city: null, state: null, postcode: null });
  });

  it('never overwrites an existing value with a later read, or with a nothing', async () => {
    await save('Fixed Supermarket', { line1: '1 Good St', city: 'Chermside', state: 'QLD', postcode: '4032' });
    await save('Fixed Supermarket', { city: 'Chermside', postcode: '4032' }); // a worse read, same place
    await save('Fixed Supermarket', null); // no address at all
    expect(await party('Fixed Supermarket')).toEqual({
      address_line1: '1 Good St',
      city: 'Chermside',
      state: 'QLD',
      postcode: '4032',
    });
  });

  it('fills only the EMPTY parts when the later read is the same place', async () => {
    await save('Partial Cafe', { city: 'Fitzroy', postcode: '3065' });
    await save('Partial Cafe', { line1: '12 Smith St', city: 'Fitzroy', state: 'VIC', postcode: '3065' });
    expect(await party('Partial Cafe')).toEqual({
      address_line1: '12 Smith St',
      city: 'Fitzroy',
      state: 'VIC',
      postcode: '3065',
    });
  });

  it('a different place for the same supplier name mixes nothing in (a chain keeps its first branch)', async () => {
    await save('Chain Servo', { city: 'Newtown', state: 'NSW', postcode: '2042' });
    await save('Chain Servo', { line1: '99 Other Rd', city: 'Mosman', state: 'NSW', postcode: '2088' });
    expect(await party('Chain Servo')).toEqual({ address_line1: null, city: 'Newtown', state: 'NSW', postcode: '2042' });
  });

  it('writes no address for a workspace on a non-Australian rule set', async () => {
    const indonesia = {
      country: 'ID',
      consumptionTax: { inclusiveFraction: { n: 11, d: 111 }, baseFraction: { n: 11, d: 12 } },
    } as unknown as TaxRules;
    await save('Warung Bali', { city: 'Ubud', state: 'NSW', postcode: '2000' }, indonesia);
    expect(await party('Warung Bali')).toEqual({ address_line1: null, city: null, state: null, postcode: null });
  });
});
