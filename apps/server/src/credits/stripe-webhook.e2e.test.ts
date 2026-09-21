import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import { startStripeSimulator, type StripeSimulator } from '../integrations/stripe-simulator.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { getCreditBalance, listCreditPurchases, startCreditPurchase } from './credits.repo.js';
import { StripePaymentProvider } from './stripe-provider.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

/**
 * `docs/INTEGRATIONS.md` Lane P ticket P2 — the only path that turns money
 * into credits, end to end, against a real Postgres and a real (simulated)
 * Stripe.
 *
 * Nothing here is mocked at the boundary that matters: the session is
 * created by the real provider over HTTP, the event is signed with a real
 * HMAC by the simulator, and the controller's real verification runs. The
 * assertions are about the CREDIT BALANCE, not about a function being
 * called — the failure this guards against is granting twice or not at all,
 * which only a balance can show.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'de000000-0000-4000-8000-0000000000c1';
const OWNER = 'de000000-0000-4000-8000-0000000000c2';

describeIfDb('the Stripe webhook', () => {
  let admin: Client;
  let sim: StripeSimulator;
  let controller: StripeWebhookController;

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Stripe webhook test co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|stripe-owner', email: 'owner@stripe-wh.test' },
      ],
    });
    sim = await startStripeSimulator();
    // The handler reads the secret from `stripeWebhookSecret()`, which
    // prefers the environment. Point it at the simulator's minted secret so
    // the verification is against a key neither side agreed in advance.
    process.env.STRIPE_WEBHOOK_SECRET = sim.webhookSecret;
    controller = new StripeWebhookController();
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
    await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [TENANT]);
    await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [TENANT]);
  });

  /** Start a purchase and take it through a real checkout-session creation. */
  async function purchaseAndCheckout() {
    const row = await startCreditPurchase(OWNER, TENANT, 'credits_100');
    // Null means the pack code does not exist or is inactive. Asserted
    // rather than `!`-ed: a retired pack code would otherwise surface as a
    // confusing null-property error several lines later.
    if (!row) throw new Error('credits_100 is not an active pack — fixture assumption broken');
    const provider = new StripePaymentProvider({
      secretKey: sim.secretKey,
      apiBase: sim.apiBase,
      successUrl: 'https://snap-apps.test/credits/thanks',
      cancelUrl: 'https://snap-apps.test/credits',
    });
    await provider.createCheckout({
      purchaseId: row.id,
      tenantId: TENANT,
      userId: OWNER,
      packCode: row.pack_code,
      credits: row.credits,
      priceAud: row.price_aud,
    });
    return { purchase: row, sessionId: sim.last()!.id };
  }

  function deliver(signed: { body: string; signature: string }) {
    return controller.stripe({
      rawBody: signed.body,
      headers: { 'stripe-signature': signed.signature },
    });
  }

  it('grants the credits when a verified payment completes', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { purchase, sessionId } = await purchaseAndCheckout();

    // Creating the checkout must not have granted anything.
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);

    await deliver(sim.pay(sessionId));

    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + purchase.credits);
    const rows = await listCreditPurchases(OWNER, TENANT);
    const fulfilled = rows.find((r) => r.id === purchase.id)!;
    expect(fulfilled.status).toBe('paid');
    // Provenance: the row records WHICH processor and WHICH session, which
    // is what makes reconciliation against Stripe possible at all.
    expect(fulfilled.provider).toBe('stripe');
  });

  it('a REPLAYED webhook grants exactly once', async () => {
    // Stripe retries until it gets a 2xx and will re-deliver on a network
    // hiccup. Granting twice is free money; this is the reason
    // `credit_purchases_provider_ref_idx` was written.
    const before = await getCreditBalance(OWNER, TENANT);
    const { purchase, sessionId } = await purchaseAndCheckout();
    const signed = sim.pay(sessionId);

    await deliver(signed);
    await deliver(signed);
    await deliver(signed);

    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + purchase.credits);
  });

  it('records the session id, so a duplicate is visible in the database', async () => {
    const { purchase, sessionId } = await purchaseAndCheckout();
    await deliver(sim.pay(sessionId));

    const { rows } = await admin.query(
      'SELECT provider::text, provider_ref FROM credit_purchases WHERE id = $1',
      [purchase.id],
    );
    expect(rows[0]).toMatchObject({ provider: 'stripe', provider_ref: sessionId });
  });

  it('REFUSES an unsigned webhook, and grants nothing', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { sessionId } = await purchaseAndCheckout();
    const signed = sim.pay(sessionId);

    await expect(
      controller.stripe({ rawBody: signed.body, headers: {} }),
    ).rejects.toThrow(/Signature verification failed/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('REFUSES a webhook signed with someone else\'s secret, and grants nothing', async () => {
    // The attack: a public URL, a plausible body, no secret.
    const before = await getCreditBalance(OWNER, TENANT);
    const { sessionId } = await purchaseAndCheckout();
    const forged = sim.pay(sessionId, { secret: 'whsec_attacker' });

    await expect(deliver(forged)).rejects.toThrow(/Signature verification failed/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('REFUSES a body altered after signing, and grants nothing', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const { sessionId } = await purchaseAndCheckout();
    const signed = sim.pay(sessionId);
    const tampered = { ...signed, body: signed.body.replace('"paid"', '"paid" ') };

    await expect(deliver(tampered)).rejects.toThrow(/Signature verification failed/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('grants NOTHING for a completed session whose payment is not yet paid', async () => {
    // The AU case this is real for: BECS direct debit completes the session
    // while the money is still in flight. Granting then is granting on an
    // intention.
    const before = await getCreditBalance(OWNER, TENANT);
    const { sessionId } = await purchaseAndCheckout();
    const signed = sim.pay(sessionId);
    // Re-signed rather than tampered, so the signature is VALID and it is
    // the payment_status alone deciding the outcome. Tampering would prove
    // the signature check again, which the test above already does.
    const event = JSON.parse(signed.body) as {
      data: { object: Record<string, unknown> };
    };
    event.data.object.payment_status = 'unpaid';
    const body = JSON.stringify(event);
    const { createHmac } = await import('node:crypto');
    const ts = Math.floor(Date.now() / 1000);
    const signature = `t=${ts},v1=${createHmac('sha256', sim.webhookSecret)
      .update(`${ts}.${body}`)
      .digest('hex')}`;

    await deliver({ body, signature });
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('accepts, and ignores, an event type it does not handle', async () => {
    // Verified and uninteresting must be a 200, or Stripe retries it
    // forever and the real failures are buried in the noise.
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ id: 'evt_x', type: 'payment_intent.created', data: { object: {} } });
    const { createHmac } = await import('node:crypto');
    const signature = `t=${ts},v1=${createHmac('sha256', sim.webhookSecret)
      .update(`${ts}.${body}`)
      .digest('hex')}`;

    await expect(deliver({ body, signature })).resolves.toEqual({ received: true });
  });
});
