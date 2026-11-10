import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import { startStripeSimulator, type StripeSimulator } from '../integrations/stripe-simulator.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { toPurchase } from './credits.controller.js';
import {
  fulfilCreditPurchase,
  fulfilCreditPurchaseFromProvider,
  getCreditDocument,
  grantGooglePlayPurchase,
  listCreditPurchases,
  refundCreditPurchaseFromProvider,
  startCreditPurchase,
} from './credits.repo.js';
import { gstInTotalCents, toCreditDocument } from './documents.js';
import { StripePaymentProvider } from './stripe-provider.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

/**
 * Group task 7.7.b, against a real Postgres: every paid purchase through the
 * website or phone checkout gets exactly one document, in the transaction that
 * marks it paid, numbered without gaps; a refund gets an adjustment note or
 * refund receipt; a Google Play purchase gets none.
 *
 * The assertions are on the DOCUMENT ROWS and what a person would read, not on
 * a function having been called. Numbers are checked per purchase (distinct,
 * ordered), never against the global counter: other suites issue documents too.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'de000000-0000-4000-8000-0000000077a1';
const OWNER = 'de000000-0000-4000-8000-0000000077a2';
const ABN = '51824753556';

describeIfDb('receipts and tax invoices for credit purchases', () => {
  let admin: Client;
  let sim: StripeSimulator;
  let webhook: StripeWebhookController;

  async function wipeIssuers() {
    await admin.query('DELETE FROM invoice_issuer_changes');
  }
  /** An approved issuer, as the two-person flow would leave it (that flow is tested over HTTP in admin/invoicing.e2e.test.ts). */
  async function approveIssuer(over: { abn: string | null; gst: boolean }) {
    await wipeIssuers();
    await admin.query(
      `INSERT INTO invoice_issuer_changes (legal_name, abn, address, email, gst_registered, reason, status, decided_at)
       VALUES ('Snap Apps Pty Ltd', $1, '1 George St, Sydney NSW 2000', 'billing@snap.test', $2, 'e2e', 'approved', now())`,
      [over.abn, over.gst],
    );
  }
  async function documentsOf(purchaseId: string) {
    const { rows } = await admin.query<{
      direction: string; kind: string; number: string; total_cents: string; gst_cents: string | null; original_number: string | null;
    }>(
      `SELECT direction, kind, number::text, total_cents::text, gst_cents::text, original_number::text
         FROM credit_documents WHERE purchase_id = $1 ORDER BY number`,
      [purchaseId],
    );
    return rows;
  }

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Documents test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|doc-owner', email: 'owner@docs-e2e.test', displayName: 'Doc Owner' }],
    });
    sim = await startStripeSimulator();
    process.env.STRIPE_WEBHOOK_SECRET = sim.webhookSecret;
    webhook = new StripeWebhookController();
  });

  afterAll(async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await sim.close();
    await wipeIssuers();
    await admin.query('DELETE FROM credit_documents WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [TENANT]);
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  beforeEach(wipeIssuers);
  afterEach(async () => {
    await admin.query('DELETE FROM credit_documents WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [TENANT]);
  });

  async function startAndPay(packCode = 'credits_100') {
    const row = await startCreditPurchase(OWNER, TENANT, packCode);
    if (!row) throw new Error(`${packCode} is not an active pack`);
    await fulfilCreditPurchaseFromProvider(OWNER, TENANT, row.id, 'stripe', `cs_${row.id}`, `pi_${row.id}`);
    return row;
  }

  it('with no issuer yet: a Receipt with no ABN and no GST statement, once, however often it is replayed', async () => {
    const row = await startCreditPurchase(OWNER, TENANT, 'credits_100');
    for (let i = 0; i < 3; i += 1) {
      await fulfilCreditPurchaseFromProvider(OWNER, TENANT, row!.id, 'stripe', 'cs_replay', 'pi_replay');
    }
    const docs = await documentsOf(row!.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ direction: 'sale', kind: 'receipt', gst_cents: null });

    const stored = await getCreditDocument(OWNER, TENANT, (await admin.query('SELECT id FROM credit_documents WHERE purchase_id = $1', [row!.id])).rows[0].id);
    const doc = toCreditDocument(stored!);
    expect(doc.title).toBe('Receipt');
    expect(doc.gstStatement).toBeNull();
    expect(doc.issuer).toBeNull();
    expect(doc.buyer).toEqual({ name: 'Documents test co', email: 'owner@docs-e2e.test' });
  });

  it('a REPLAYED Stripe webhook leaves exactly one document', async () => {
    const row = await startCreditPurchase(OWNER, TENANT, 'credits_100');
    const provider = new StripePaymentProvider({
      secretKey: sim.secretKey,
      apiBase: sim.apiBase,
      successUrl: 'https://snap-apps.test/credits/thanks',
      cancelUrl: 'https://snap-apps.test/credits',
    });
    await provider.createCheckout({
      purchaseId: row!.id, tenantId: TENANT, userId: OWNER, packCode: row!.pack_code, credits: row!.credits, priceAud: row!.price_aud,
    });
    const signed = sim.pay(sim.last()!.id);
    for (let i = 0; i < 3; i += 1) {
      await webhook.stripe({ rawBody: signed.body, headers: { 'stripe-signature': signed.signature } });
    }
    expect(await documentsOf(row!.id)).toHaveLength(1);
  });

  it('with a valid ABN and GST registered: a Tax invoice, and the GST is an eleventh to the cent', async () => {
    await approveIssuer({ abn: ABN, gst: true });
    const row = await startAndPay('credits_100');
    const docs = await documentsOf(row.id);
    const totalCents = Math.round(Number(row.price_aud) * 100);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ kind: 'tax_invoice', total_cents: String(totalCents), gst_cents: String(gstInTotalCents(totalCents)) });

    const id = (await admin.query('SELECT id FROM credit_documents WHERE purchase_id = $1', [row.id])).rows[0].id;
    const doc = toCreditDocument((await getCreditDocument(OWNER, TENANT, id))!);
    expect(doc.title).toBe('Tax invoice');
    expect(doc.issuer?.abn).toBe('51 824 753 556');
    expect(doc.issuer?.legalName).toBe('Snap Apps Pty Ltd');
    expect(doc.gstStatement).toMatch(/^Total includes GST of A\$\d+\.\d\d$/);
  });

  it('a valid ABN without GST registration stays a Receipt', async () => {
    await approveIssuer({ abn: ABN, gst: false });
    const row = await startAndPay();
    expect((await documentsOf(row.id))[0]).toMatchObject({ kind: 'receipt', gst_cents: null });
  });

  it('later purchases get later numbers, with none skipped between them', async () => {
    const a = await startAndPay();
    const b = await startAndPay();
    const c = await startAndPay();
    const numbers = [a, b, c].map(async (r) => Number((await documentsOf(r.id))[0]!.number));
    const [na, nb, nc] = await Promise.all(numbers);
    expect(nb! - na!).toBe(1);
    expect(nc! - nb!).toBe(1);
  });

  it('a refund of a tax invoice is an Adjustment note with the negative amount and GST; replaying it adds nothing', async () => {
    await approveIssuer({ abn: ABN, gst: true });
    const row = await startAndPay('credits_100');
    for (let i = 0; i < 2; i += 1) {
      await refundCreditPurchaseFromProvider(OWNER, TENANT, row.id, `pi_${row.id}`);
    }
    const docs = await documentsOf(row.id);
    expect(docs.map((d) => d.kind)).toEqual(['tax_invoice', 'adjustment_note']);
    const [sale, refund] = docs;
    expect(Number(refund!.total_cents)).toBe(-Number(sale!.total_cents));
    expect(Number(refund!.gst_cents)).toBe(-Number(sale!.gst_cents));
    expect(refund!.original_number).toBe(sale!.number);

    const id = (await admin.query(`SELECT id FROM credit_documents WHERE purchase_id = $1 AND direction = 'refund'`, [row.id])).rows[0].id;
    const doc = toCreditDocument((await getCreditDocument(OWNER, TENANT, id))!);
    expect(doc.title).toBe('Adjustment note');
    expect(doc.reference).toBe(`Adjusts tax invoice SNAP-${sale!.number.padStart(6, '0')}`);
    expect(doc.total.startsWith('-A$')).toBe(true);
  });

  it('a refund of a receipt is a Refund receipt with no GST', async () => {
    const row = await startAndPay();
    await refundCreditPurchaseFromProvider(OWNER, TENANT, row.id, `pi_${row.id}`);
    const docs = await documentsOf(row.id);
    expect(docs.map((d) => d.kind)).toEqual(['receipt', 'refund_receipt']);
    expect(docs[1]!.gst_cents).toBeNull();
  });

  it('the manual fulfil path issues a document too, once', async () => {
    const row = await startCreditPurchase(OWNER, TENANT, 'credits_100');
    await fulfilCreditPurchase(OWNER, TENANT, row!.id);
    await fulfilCreditPurchase(OWNER, TENANT, row!.id);
    expect(await documentsOf(row!.id)).toHaveLength(1);
  });

  it('a Google Play purchase gets no document, and its history line says Google issues the receipt', async () => {
    const result = await grantGooglePlayPurchase(OWNER, TENANT, 'credits_100', 'play-token-docs-1', 'GPA.1234');
    if (result === null || result === 'other_workspace') throw new Error('expected a Play purchase');
    expect(await documentsOf(result.row.id)).toHaveLength(0);
    // A Play refund is a void, not ours to document either.
    await refundCreditPurchaseFromProvider(OWNER, TENANT, result.row.id, 'GPA.1234');
    expect(await documentsOf(result.row.id)).toHaveLength(0);

    const history = (await listCreditPurchases(OWNER, TENANT)).map(toPurchase);
    const play = history.find((p) => p.id === result.row.id)!;
    expect(play.documents).toEqual([]);
    expect(play.receiptNote).toBe('Google issues the receipt for this purchase');
  });

  it('the purchase history lists each purchase’s documents, and only this workspace can read one', async () => {
    const row = await startAndPay();
    const history = (await listCreditPurchases(OWNER, TENANT)).map(toPurchase);
    const mine = history.find((p) => p.id === row.id)!;
    expect(mine.documents).toHaveLength(1);
    expect(mine.documents![0]).toMatchObject({ kind: 'receipt', title: 'Receipt' });
    expect(mine.documents![0]!.number).toMatch(/^SNAP-\d{6,}$/);
    expect(mine.receiptNote).toBeNull();

    // Another workspace reading this document id finds nothing.
    const stranger = await getCreditDocument('de000000-0000-4000-8000-0000000077ff', 'de000000-0000-4000-8000-0000000077fe', mine.documents![0]!.id).catch(() => null);
    expect(stranger).toBeNull();
  });
});
