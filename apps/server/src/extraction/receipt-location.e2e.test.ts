import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Document } from '@snap/api-contract/docdom';
import { withTenantAs } from '@snap/db';
import type { TaxRules } from '@snap/tax-rules';

import { closeDb, getDb } from '../db.js';
import { saveExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { openWorkerDb, type WorkerDb } from '../test-support/worker-db.js';
import { enterTenantAsWorker } from '../tenant-entry.js';
import { backfillMerchantLocations } from './merchant-backfill.repo.js';
import type { SupplierAddress, ValidatedExtraction } from './types.js';

/**
 * Plan task 9.5.i: where each RECEIPT was bought, stored on the receipt
 * (`documents.merchant_*`, migration 0061) and not only on its supplier.
 *
 * Against real Postgres as the worker, through RLS, like
 * `merchant-location.e2e.test.ts` (9.5.h, the supplier half, still asserted
 * there and unchanged). Skips cleanly without `DATABASE_URL`. Fixtures are
 * built BY HAND, bypassing `parseExtraction`, so the privacy refusals below
 * prove the write boundary's own defences and not a restatement of the parser
 * tests in `merchant-address.test.ts`.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c6c6c6c6-0000-4000-8000-000000000001';
const OTHER_TENANT = 'c6c6c6c6-0000-4000-8000-000000000002';
const NON_AU_TENANT = 'c6c6c6c6-0000-4000-8000-000000000003';
const WORKER = 'c6c6c6c6-0000-4000-8000-0000000000a1';
const OWNER = 'c6c6c6c6-0000-4000-8000-0000000000a2';
const OTHER_OWNER = 'c6c6c6c6-0000-4000-8000-0000000000a3';
const NON_AU_OWNER = 'c6c6c6c6-0000-4000-8000-0000000000a4';

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

function reading(supplier: string | null, a: Addr | null): ValidatedExtraction {
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

type Place = { merchant_line1: string | null; merchant_city: string | null; merchant_state: string | null; merchant_postcode: string | null };
type PartyRow = { address_line1: string | null; city: string | null; state: string | null; postcode: string | null };

const NOWHERE: Place = { merchant_line1: null, merchant_city: null, merchant_state: null, merchant_postcode: null };

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

/** A one-span-per-line DocDOM, laid out top to bottom, first page only. */
function docdom(lines: string[]): Document {
  const box = (y: number) => ({ x: 10, y, width: 100, height: 10 });
  const prov = { engine: 'test', confidence: 0.99 };
  return {
    version: 1,
    pages: [],
    blocks: [
      {
        id: 'b0',
        kind: 'paragraph',
        box: box(0),
        page: 1,
        order: 0,
        provenance: prov,
        lines: lines.map((text, i) => ({
          id: `l${i}`,
          box: box(i * 12),
          order: i,
          spans: [{ id: `s${i}`, text, box: box(i * 12), provenance: prov }],
        })),
      },
    ],
    tables: [],
    figures: [],
    fields: [],
    unreadable: [],
  } as unknown as Document;
}

describeIfDb('merchant location on each receipt (9.5.i)', () => {
  let admin: Client;
  let adminOther: Client;
  let adminNonAu: Client;
  let worker: WorkerDb;

  /** Saves one reading as its own receipt (its own capture) and returns the document id. */
  const save = async (supplier: string | null, a: Addr | null, rules: TaxRules | null = null) => {
    const captureId = await makeCapture();
    const { documentId } = await saveExtraction(worker.actor, TENANT, captureId, reading(supplier, a), META, rules);
    return { documentId, captureId };
  };
  const place = async (documentId: string): Promise<Place> =>
    (
      await q<Place>(sql`
        select merchant_line1, merchant_city, merchant_state, merchant_postcode
          from documents where id = ${documentId}
      `)
    ).rows[0]!;
  const party = async (name: string): Promise<PartyRow> => {
    const r = await q<PartyRow>(sql`
      select address_line1, city, state, postcode from parties
       where legal_name = ${name} and kind = 'supplier'
    `);
    expect(r.rows.length, `exactly one supplier called ${name}`).toBe(1);
    return r.rows[0]!;
  };

  beforeAll(async () => {
    if (!hasDb) return;
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Receipt location test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|receipt-location-owner', email: 'owner@receipt-location.test' }],
      serviceUsers: [
        {
          id: WORKER,
          subject: 'test|receipt-location-worker',
          email: 'worker@receipt-location.test',
          displayName: 'Extraction Worker',
        },
      ],
    });
    adminOther = await provisionTenant({
      tenantId: OTHER_TENANT,
      name: 'Receipt location other co',
      users: [
        { id: OTHER_OWNER, role: 'owner', subject: 'test|receipt-location-other', email: 'other@receipt-location.test' },
      ],
    });
    adminNonAu = await provisionTenant({
      tenantId: NON_AU_TENANT,
      name: 'Receipt location Indonesian co',
      users: [
        { id: NON_AU_OWNER, role: 'owner', subject: 'test|receipt-location-id', email: 'id@receipt-location.test' },
      ],
    });
    await adminNonAu.query(`update tenants set country = 'ID' where id = $1`, [NON_AU_TENANT]);
    worker = openWorkerDb(WORKER);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await wipeTenant(admin, TENANT, [WORKER, OWNER]);
    await wipeTenant(adminOther, OTHER_TENANT, [OTHER_OWNER]);
    await wipeTenant(adminNonAu, NON_AU_TENANT, [NON_AU_OWNER]);
    await admin.end();
    await adminOther.end();
    await adminNonAu.end();
    await worker.pool.end();
    await closeDb();
  });

  /* ── On save ───────────────────────────────────────────────────────────── */

  it('two receipts from the same chain at different branches store different locations', async () => {
    const first = await save('Chain Servo 9.5.i', {
      line1: '245 Parramatta Rd',
      city: 'Haymarket',
      state: 'NSW',
      postcode: '2000',
    });
    const second = await save('Chain Servo 9.5.i', {
      line1: '99 Other Rd',
      city: 'Mosman',
      state: 'NSW',
      postcode: '2088',
    });
    expect(first.documentId).not.toBe(second.documentId);

    expect(await place(first.documentId)).toEqual({
      merchant_line1: '245 Parramatta Rd',
      merchant_city: 'Haymarket',
      merchant_state: 'NSW',
      merchant_postcode: '2000',
    });
    expect(await place(second.documentId)).toEqual({
      merchant_line1: '99 Other Rd',
      merchant_city: 'Mosman',
      merchant_state: 'NSW',
      merchant_postcode: '2088',
    });

    // Both receipts hang off ONE supplier row, which (9.5.h, unchanged) keeps
    // only the first branch. That is exactly why the location lives on the receipt.
    const supplier = await q<{ supplier_id: string }>(sql`
      select supplier_id from documents where id in (${first.documentId}, ${second.documentId})
    `);
    expect(new Set(supplier.rows.map((r) => r.supplier_id)).size).toBe(1);
    expect(await party('Chain Servo 9.5.i')).toEqual({
      address_line1: '245 Parramatta Rd',
      city: 'Haymarket',
      state: 'NSW',
      postcode: '2000',
    });
  });

  it('a receipt with no address stores NULL in all four, and still does not touch the supplier', async () => {
    const { documentId } = await save('Cash Only Kiosk 9.5.i', null);
    expect(await place(documentId)).toEqual(NOWHERE);
    expect(await party('Cash Only Kiosk 9.5.i')).toEqual({
      address_line1: null,
      city: null,
      state: null,
      postcode: null,
    });
  });

  it('a receipt whose business name was not read still records where it was bought', async () => {
    const { documentId } = await save(null, { city: 'Fitzroy', state: 'VIC', postcode: '3065' });
    expect(await place(documentId)).toEqual({
      merchant_line1: null,
      merchant_city: 'Fitzroy',
      merchant_state: 'VIC',
      merchant_postcode: '3065',
    });
  });

  it('re-normalises at the write boundary: a hand-built full state name, shouting suburb and bad postcode never land raw', async () => {
    const { documentId } = await save('Hand Built Cafe 9.5.i', {
      city: 'BONDI JUNCTION',
      state: 'New South Wales',
      postcode: '20220',
    });
    expect(await place(documentId)).toEqual({
      merchant_line1: null,
      merchant_city: 'Bondi Junction',
      merchant_state: 'NSW',
      merchant_postcode: null,
    });
  });

  it('a re-extraction replaces the whole location with the new reading, and a reading with none keeps what is there', async () => {
    const { documentId, captureId } = await save('Rerun Cafe 9.5.i', { city: 'Newtown', state: 'NSW', postcode: '2042' });
    expect(await place(documentId)).toMatchObject({ merchant_city: 'Newtown', merchant_postcode: '2042' });

    // A better reading of the same image: replaces all four together.
    await saveExtraction(
      worker.actor,
      TENANT,
      captureId,
      reading('Rerun Cafe 9.5.i', { line1: '12 King St', city: 'Newtown', state: 'NSW', postcode: '2042' }),
      META,
      null,
    );
    expect(await place(documentId)).toEqual({
      merchant_line1: '12 King St',
      merchant_city: 'Newtown',
      merchant_state: 'NSW',
      merchant_postcode: '2042',
    });

    // A later reading that found no address must not erase it.
    await saveExtraction(worker.actor, TENANT, captureId, reading('Rerun Cafe 9.5.i', null), META, null);
    expect(await place(documentId)).toEqual({
      merchant_line1: '12 King St',
      merchant_city: 'Newtown',
      merchant_state: 'NSW',
      merchant_postcode: '2042',
    });
  });

  it('writes no location for a workspace on a non-Australian rule set', async () => {
    const indonesia = {
      country: 'ID',
      consumptionTax: { inclusiveFraction: { n: 11, d: 111 }, baseFraction: { n: 11, d: 12 } },
    } as unknown as TaxRules;
    const { documentId } = await save('Warung Bali 9.5.i', { city: 'Ubud', state: 'NSW', postcode: '2000' }, indonesia);
    expect(await place(documentId)).toEqual(NOWHERE);
  });

  /* ── The existing privacy refusals, on the receipt ─────────────────────── */

  it('privacy: a street line that looks like a card number, phone, e-mail or customer label is refused, the suburb survives', async () => {
    const bad = [
      '4417 1234 5678 9012',
      'Card XXXX XXXX XXXX 4417',
      'Ph 02 9999 8888 12 High St',
      'accounts@shop.example',
      'www.shop.example',
      'Deliver to 9 Private Ln',
      'Bill to 4 Other Rd',
    ];
    for (const street of bad) {
      const { documentId } = await save('Refuses Street 9.5.i', { line1: street, city: 'Newtown', state: 'NSW', postcode: '2042' });
      expect(await place(documentId), street).toEqual({
        merchant_line1: null,
        merchant_city: 'Newtown',
        merchant_state: 'NSW',
        merchant_postcode: '2042',
      });
    }
  });

  it('privacy: a state that contradicts the postcode drops the whole address rather than store half a wrong pin', async () => {
    const { documentId } = await save('Clash Pty Ltd 9.5.i', {
      line1: '12 Smith St',
      city: 'Richmond',
      state: 'NSW',
      postcode: '3121',
    });
    expect(await place(documentId)).toEqual(NOWHERE);
  });

  it('privacy: a lone state or a lone street line is not a location and is not stored', async () => {
    expect(await place((await save('Lone State 9.5.i', { state: 'NSW' })).documentId)).toEqual(NOWHERE);
    expect(await place((await save('Lone Street 9.5.i', { line1: '12 High St' })).documentId)).toEqual(NOWHERE);
  });

  /* ── RLS still holds ───────────────────────────────────────────────────── */

  it("another workspace cannot read this workspace's receipt locations, even by id", async () => {
    const { documentId } = await save('Private Place Cafe 9.5.i', { city: 'Mosman', state: 'NSW', postcode: '2088' });
    expect((await place(documentId)).merchant_city).toBe('Mosman'); // the owner sees it

    const other = await withTenantAs(getDb(), OTHER_OWNER, OTHER_TENANT, async (tx) => {
      const byId = await tx.execute(sql`select merchant_city from documents where id = ${documentId}`);
      const all = await tx.execute(sql`select merchant_city from documents where merchant_city is not null`);
      return { byId: byId.rows, all: all.rows };
    });
    expect(other.byId).toHaveLength(0);
    expect(other.all).toHaveLength(0);

    // And cannot write into it: an UPDATE by id matches no row.
    const hijack = await withTenantAs(getDb(), OTHER_OWNER, OTHER_TENANT, (tx) =>
      tx.execute(sql`update documents set merchant_city = 'Hijacked' where id = ${documentId}`),
    );
    expect(hijack.rowCount).toBe(0);
    expect((await place(documentId)).merchant_city).toBe('Mosman');
  });

  /* ── The backfill ──────────────────────────────────────────────────────── */

  describe('backfill from stored layouts', () => {
    // OCR text the backfill reads. Both lines hold things that must never be
    // printed or stored: a customer's name and place (below the items) and a
    // card line. The header is the only part ever parsed.
    const SECRET_CUSTOMER = 'Jane Citizen';
    const SECRET_CARD = 'VISA ************4417';
    const layoutFor = (street: string, placeLine: string) =>
      docdom([
        'BP TRUCKSTOP',
        street,
        placeLine,
        'ABN 85 129 887 341',
        'Unleaded 45.2L $98.40',
        'TOTAL $98.40',
        SECRET_CARD,
        `Deliver to: ${SECRET_CUSTOMER}`,
        '9 Private Ln',
        'MOSMAN NSW 2088',
      ]);

    const layouts = new Map<string, Document>();
    const read = (key: string): Buffer => {
      const doc = layouts.get(key);
      if (!doc) throw new Error(`no such stored layout: ${key}`);
      return Buffer.from(JSON.stringify(doc), 'utf8');
    };
    /** Saves a receipt with no address (as before 9.5.h) and gives its capture a stored layout. */
    const legacyReceipt = async (supplier: string, doc: Document | null) => {
      const { documentId, captureId } = await save(supplier, null);
      if (doc) {
        const key = `${TENANT}/layouts/${captureId}/test.json`;
        layouts.set(key, doc);
        await admin.query(
          `insert into document_layouts (id, tenant_id, capture_id, storage_key, docdom_version, page_count)
           values ($1, $2, $3, $4, '1.0.0', 1)`,
          [randomUUID(), TENANT, captureId, key],
        );
      }
      return documentId;
    };
    const run = async (apply: boolean, tenantId = TENANT) => {
      const lines: string[] = [];
      const result = await enterTenantAsWorker(worker.actor, tenantId, (tx) =>
        backfillMerchantLocations(tx, tenantId, { apply, limit: 1000, read, log: (l) => lines.push(l) }),
      );
      return { result, lines };
    };

    let hay: string;
    let mos: string;
    let noLayout: string;
    let noAddr: string;
    let already: string;

    beforeAll(async () => {
      if (!hasDb) return;
      // Same chain, two branches, both scanned before addresses were read.
      hay = await legacyReceipt('Backfill Chain 9.5.i', layoutFor('245 Parramatta Rd', 'HAYMARKET NSW 2000'));
      mos = await legacyReceipt('Backfill Chain 9.5.i', layoutFor('99 Military Rd', 'MOSMAN NSW 2088'));
      noLayout = await legacyReceipt('Backfill No Layout 9.5.i', null);
      noAddr = await legacyReceipt('Backfill No Address 9.5.i', docdom(['Joe Cafe', 'ABN 85 129 887 341', 'Thank you']));
      // A receipt that already has its own place (so there is nothing to fill).
      already = (await save('Backfill Already 9.5.i', { city: 'Fitzroy', state: 'VIC', postcode: '3065' })).documentId;
    });

    it('a dry run reports what it would fill and writes nothing', async () => {
      const { result, lines } = await run(false);
      expect(result.skipped).toBe(false);
      expect(result.receiptsFilled).toBeGreaterThanOrEqual(2);
      expect(lines.some((l) => l.startsWith('would fill receipt'))).toBe(true);
      expect(lines.some((l) => l.startsWith('fill '))).toBe(false);
      expect(await place(hay)).toEqual(NOWHERE);
      expect(await place(mos)).toEqual(NOWHERE);
    });

    it('never prints OCR text: only ids and the normalised place', async () => {
      const { lines } = await run(false);
      const all = lines.join('\n');
      for (const secret of [SECRET_CUSTOMER, SECRET_CARD, 'Private Ln', 'BP TRUCKSTOP', 'Unleaded', 'TOTAL', 'ABN', 'Thank you', 'Joe Cafe']) {
        expect(all, secret).not.toContain(secret);
      }
      // What it does print is the normalised place of the header, plus a flag for a street.
      expect(all).toMatch(/would fill receipt [0-9a-f-]{36}: Haymarket NSW 2000 \(\+street\)/);
    });

    it('applied, each receipt gets the address of its OWN layout, so the two branches differ', async () => {
      const { result } = await run(true);
      expect(result.receiptsFilled).toBeGreaterThanOrEqual(2);
      expect(await place(hay)).toEqual({
        merchant_line1: '245 Parramatta Rd',
        merchant_city: 'Haymarket',
        merchant_state: 'NSW',
        merchant_postcode: '2000',
      });
      expect(await place(mos)).toEqual({
        merchant_line1: '99 Military Rd',
        merchant_city: 'Mosman',
        merchant_state: 'NSW',
        merchant_postcode: '2088',
      });
      // The customer's place further down the docket ("MOSMAN NSW 2088" under
      // "Deliver to") is never what is read: the Haymarket receipt's layout has
      // the same customer block and still stored Haymarket, not Mosman.
      expect((await place(hay)).merchant_city).toBe('Haymarket');
    });

    it('9.5.h unchanged: the supplier takes the NEWEST receipt that parses, once', async () => {
      const p = await party('Backfill Chain 9.5.i');
      // `mos` was saved after `hay`, so it is the newest receipt.
      expect(p).toEqual({ address_line1: '99 Military Rd', city: 'Mosman', state: 'NSW', postcode: '2088' });
    });

    it('leaves receipts with no stored layout, or no header address, empty', async () => {
      expect(await place(noLayout)).toEqual(NOWHERE);
      expect(await place(noAddr)).toEqual(NOWHERE);
    });

    it('fills only empty receipts: a receipt that already has a place is never overwritten', async () => {
      expect(await place(already)).toEqual({
        merchant_line1: null,
        merchant_city: 'Fitzroy',
        merchant_state: 'VIC',
        merchant_postcode: '3065',
      });
    });

    it('is idempotent: a second applied run fills nothing and changes nothing', async () => {
      const before = [await place(hay), await place(mos), await place(already)];
      const { result, lines } = await run(true);
      expect(result.receiptsFilled).toBe(0);
      expect(result.suppliersFilled).toBe(0);
      expect(lines).toEqual([]);
      expect([await place(hay), await place(mos), await place(already)]).toEqual(before);
    });

    it('does not overwrite an address stored between the read and the write', async () => {
      // A receipt that is empty and has a layout, filled by a person/scan in the meantime.
      const late = await legacyReceipt('Backfill Late 9.5.i', layoutFor('1 Late St', 'ULTIMO NSW 2007'));
      await q(sql`update documents set merchant_city = 'Chippendale', merchant_state = 'NSW', merchant_postcode = '2008' where id = ${late}`);
      await run(true);
      expect(await place(late)).toEqual({
        merchant_line1: null,
        merchant_city: 'Chippendale',
        merchant_state: 'NSW',
        merchant_postcode: '2008',
      });
    });

    it('skips a workspace that is not Australian', async () => {
      const { result, lines } = await run(true, NON_AU_TENANT);
      expect(result.skipped).toBe(true);
      expect(result.receiptsFilled).toBe(0);
      expect(lines).toEqual([]);
    });
  });
});
