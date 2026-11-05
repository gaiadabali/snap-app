import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import {
  startStripeSimulator,
  type SignedEvent,
  type StripeSimulator,
} from '../integrations/stripe-simulator.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import {
  getCreditBalance,
  listCreditPacks,
  listCreditPurchases,
  startCreditPurchase,
} from './credits.repo.js';
import { StripePaymentProvider } from './stripe-provider.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

/**
 * Group task 7.5.a: a customer pays on the simulated checkout PAGE, the
 * simulator sends the signed webhook itself, and a refund on that page takes
 * the credits back. Real provider, real HTTP, real signatures, real Postgres;
 * the only thing standing in for the internet is `deliver`, which calls the
 * controller the way Stripe's POST would.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'de000000-0000-4000-8000-0000000007a1';
const OWNER = 'de000000-0000-4000-8000-0000000007a2';

describeIfDb('the simulated checkout page', () => {
  let admin: Client;
  let sim: StripeSimulator;
  const controller = new StripeWebhookController();
  /** Every event the simulator delivered, in order. */
  const delivered: SignedEvent[] = [];
  /** Deliveries still to fail before the controller is reached. */
  let failNext = 0;

  const toController = (signed: SignedEvent) =>
    controller.stripe({ rawBody: signed.body, headers: { 'stripe-signature': signed.signature } });

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Stripe checkout page test co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|stripe-page-owner', email: 'owner@stripe-page.test' },
      ],
    });
    sim = await startStripeSimulator({
      retryDelaysMs: [20, 20],
      async deliver(signed) {
        if (failNext > 0) {
          failNext -= 1;
          throw new Error('the app did not answer');
        }
        delivered.push(signed);
        await toController(signed);
      },
    });
    process.env.STRIPE_WEBHOOK_SECRET = sim.webhookSecret;
  });

  afterAll(async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await sim.close();
    await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [TENANT]);
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  afterEach(async () => {
    delivered.length = 0;
    failNext = 0;
    await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [TENANT]);
  });

  /** A pending purchase of whichever pack is first on sale, and its checkout page URL. */
  async function checkout() {
    // The pack list is read, not named: prices and pack sizes change by migration.
    const [pack] = await listCreditPacks(OWNER, TENANT);
    const purchase = await startCreditPurchase(OWNER, TENANT, pack!.code);
    const session = await new StripePaymentProvider({
      secretKey: sim.secretKey,
      apiBase: sim.apiBase,
      successUrl: 'https://snap-apps.test/credits/thanks',
      cancelUrl: 'https://snap-apps.test/app/credits',
    }).createCheckout({
      purchaseId: purchase!.id,
      tenantId: TENANT,
      userId: OWNER,
      packCode: purchase!.pack_code,
      credits: purchase!.credits,
      priceAud: purchase!.price_aud,
    });
    if (session.state !== 'redirect' || !session.url) throw new Error('expected a redirect');
    return { purchase: purchase!, url: session.url };
  }

  function submit(url: string, form: Record<string, string>) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      redirect: 'manual',
    });
  }

  async function statusOf(purchaseId: string) {
    return (await listCreditPurchases(OWNER, TENANT)).find((r) => r.id === purchaseId)?.status;
  }

  it('shows the page, says it is simulated, and takes no scripts', async () => {
    const { url } = await checkout();
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Simulated payment, no real money');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('4242 pays: the webhook grants the pack once, and a duplicate grants nothing more', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { purchase, url } = await checkout();

    const paid = await submit(url, { op: 'pay', card: '4242 4242 4242 4242' });
    expect(paid.status).toBe(303);
    expect(paid.headers.get('location')).toBe('https://snap-apps.test/credits/thanks');
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + purchase.credits);
    expect(await statusOf(purchase.id)).toBe('paid');

    // Stripe re-delivers; a second submit of the same page pays nothing again.
    await toController(delivered[0]!);
    await submit(url, { op: 'pay', card: '4242424242424242' });
    expect(delivered).toHaveLength(1);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + purchase.credits);
  });

  it('a declined card grants nothing, sends nothing, and the number is not echoed', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { purchase, url } = await checkout();

    const declined = await submit(url, { op: 'pay', card: '4000 0000 0000 0002' });
    expect(declined.status).toBe(402);
    const html = await declined.text();
    expect(html).toContain('declined');
    // Only the hint names the card; the field comes back empty.
    expect(html).not.toContain('value="4000');
    expect(html.match(/4000 0000 0000 0002/g)).toHaveLength(1);
    expect(delivered).toHaveLength(0);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
    expect(await statusOf(purchase.id)).toBe('pending');
  });

  it('refuses a card that is not a test card', async () => {
    const { purchase, url } = await checkout();
    const refused = await submit(url, { op: 'pay', card: '5555 5555 5555 4444' });
    expect(refused.status).toBe(400);
    expect(delivered).toHaveLength(0);
    expect(await statusOf(purchase.id)).toBe('pending');
  });

  it('a refund takes back what is left of the pack, once', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { purchase, url } = await checkout();
    await submit(url, { op: 'pay', card: '4242424242424242' });
    // Three of the pack's scans were already used: they stay used.
    await admin.query(
      `UPDATE usage_grants SET remaining = remaining - 3
        WHERE id = (SELECT grant_id FROM credit_purchases WHERE id = $1)`,
      [purchase.id],
    );

    const refunded = await submit(url, { op: 'refund' });
    expect(refunded.status).toBe(200);
    expect(await refunded.text()).toContain('Refunded');
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
    expect(await statusOf(purchase.id)).toBe('refunded');

    // The refund event again, and the page again: nothing more happens.
    await toController(delivered[1]!);
    await submit(url, { op: 'refund' });
    expect(delivered).toHaveLength(2);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
    const { rows } = await admin.query('SELECT paid_at FROM credit_purchases WHERE id = $1', [
      purchase.id,
    ]);
    expect(rows[0].paid_at).not.toBeNull();
  });

  it('retries the webhook while the app does not answer, and grants once', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { purchase, url } = await checkout();
    failNext = 1;

    await submit(url, { op: 'pay', card: '4242424242424242' });
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);

    await expect.poll(() => getCreditBalance(OWNER, TENANT), { timeout: 2000 }).toBe(
      before + purchase.credits,
    );
    expect(delivered).toHaveLength(1);
  });
});
