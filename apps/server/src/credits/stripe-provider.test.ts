import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { startStripeSimulator, type StripeSimulator } from '../integrations/stripe-simulator.js';
import {
  audToCents,
  StripeError,
  StripePaymentProvider,
  verifyStripeSignature,
} from './stripe-provider.js';

/**
 * `docs/INTEGRATIONS.md` Lane P, tickets P1 and P3.
 *
 * The checkout tests drive the real `StripePaymentProvider` over real HTTP
 * against a server that speaks Stripe's Checkout Sessions shape: real form
 * encoding, real JSON, real 401. The signature tests are pure, because the
 * HMAC is arithmetic and should be assertable without a socket.
 */

const started: StripeSimulator[] = [];

async function sim() {
  const s = await startStripeSimulator();
  started.push(s);
  return s;
}

function providerFor(s: StripeSimulator, overrides: Record<string, unknown> = {}) {
  return new StripePaymentProvider({
    secretKey: s.secretKey,
    apiBase: s.apiBase,
    successUrl: 'https://snap-apps.test/credits/thanks',
    cancelUrl: 'https://snap-apps.test/credits',
    ...overrides,
  });
}

const request = {
  purchaseId: '3f1b5a52-0000-4000-8000-000000000001',
  tenantId: '3f1b5a52-0000-4000-8000-0000000000t1'.replace('t1', '11'),
  userId: '3f1b5a52-0000-4000-8000-000000000021',
  packCode: 'pack_100',
  credits: 100,
  priceAud: '44.78',
};

afterEach(async () => {
  await Promise.all(started.splice(0).map((s) => s.close()));
});

describe('creating a Stripe checkout session', () => {
  it('returns a redirect descriptor, not a vendor object', async () => {
    // The port is shaped this way so StoreKit stays possible: Apple hands
    // back a product identifier the phone redeems, Stripe hands back a URL.
    // The UI branches on the descriptor.
    const s = await sim();
    const session = await providerFor(s).createCheckout(request);

    expect(session).toMatchObject({
      purchaseId: request.purchaseId,
      provider: 'stripe',
      state: 'redirect',
    });
    expect(session.url).toContain(s.apiBase);
  });

  it('sends the price as integer cents, computed from the decimal STRING', async () => {
    // The most likely money bug in this integration. `44.78 * 100` is
    // 4477.999999999999 in floating point; `price_aud` is a decimal string
    // for exactly that reason and the conversion works on digits.
    const s = await sim();
    await providerFor(s).createCheckout(request);

    expect(s.last()!.amountTotal).toBe(4478);
    expect(s.last()!.currency).toBe('aud');
  });

  it('gets the bracketed FORM encoding right — the simulator parses it back', async () => {
    // If `line_items[0][price_data][unit_amount]` were built wrongly the
    // session would come back with nulls. This is the single best reason
    // the simulator serves the real wire shape rather than JSON.
    const s = await sim();
    await providerFor(s).createCheckout(request);

    const last = s.last()!;
    expect(last.amountTotal).not.toBeNull();
    expect(last.productName).toBe('100 scans (pack_100)');
    expect(last.clientReferenceId).toBe(request.purchaseId);
  });

  it('carries the metadata the WEBHOOK will have nothing else to go on', async () => {
    // A webhook arrives with no session and no workspace. These three
    // fields are how the handler re-enters the tenant's RLS context; without
    // them it would have to search across tenants.
    const s = await sim();
    await providerFor(s).createCheckout(request);

    expect(s.last()!.metadata).toEqual({
      purchase_id: request.purchaseId,
      tenant_id: request.tenantId,
      user_id: request.userId,
    });
  });

  it('surfaces a rejected API key rather than returning an unusable session', async () => {
    const s = await sim();
    const provider = providerFor(s, { secretKey: 'sk_test_wrong' });

    await expect(provider.createCheckout(request)).rejects.toThrow(StripeError);
    await expect(provider.createCheckout(request)).rejects.toThrow(/Invalid API Key/);
  });

  it('says nothing was charged when Stripe cannot be reached', async () => {
    const s = await sim();
    const apiBase = s.apiBase;
    const secretKey = s.secretKey;
    await s.close();
    started.splice(started.indexOf(s), 1);

    const provider = new StripePaymentProvider({
      secretKey,
      apiBase,
      successUrl: 'https://x/t',
      cancelUrl: 'https://x/c',
      timeoutMs: 2_000,
    });
    await expect(provider.createCheckout(request)).rejects.toThrow(/Nothing was charged/);
  });

  it('refuses to construct without a secret key', () => {
    expect(
      () =>
        new StripePaymentProvider({ secretKey: '', successUrl: 'https://x', cancelUrl: 'https://y' }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });
});

describe('AUD decimal strings to integer cents', () => {
  it('converts exactly, including the cases floating point gets wrong', () => {
    expect(audToCents('44.78')).toBe(4478);
    expect(audToCents('0.10')).toBe(10);
    expect(audToCents('29')).toBe(2900);
    expect(audToCents('29.5')).toBe(2950);
    expect(audToCents('1234567.89')).toBe(123456789);
  });

  it('accepts the four decimal places the column actually stores', () => {
    // `credit_purchases.price_aud` is numeric(12,4), so Postgres hands back
    // '44.7800' — four places, the last two zero. Refusing that would
    // reject every real price in the table, which is the version of this
    // check that would have been wrong in production rather than in a test.
    expect(audToCents('44.7800')).toBe(4478);
    expect(audToCents('29.0000')).toBe(2900);
  });

  it('REFUSES sub-cent precision rather than rounding it away', () => {
    // Silently dropping a fraction of a cent from a price is the kind of
    // thing nobody notices until reconciliation.
    expect(() => audToCents('44.784')).toThrow(/sub-cent/);
  });

  it('refuses something that is not a decimal amount', () => {
    for (const bad of ['', 'free', '1.2.3', '$44.78']) {
      expect(() => audToCents(bad)).toThrow(StripeError);
    }
  });
});

describe('verifying a Stripe-Signature', () => {
  const secret = 'whsec_test_abcdefghijklmnop';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  const now = 1_700_000_000;
  const sign = (payload: string, ts: number, key = secret) =>
    createHmac('sha256', key).update(`${ts}.${payload}`).digest('hex');

  it('accepts a correctly signed payload', () => {
    const header = `t=${now},v1=${sign(body, now)}`;
    expect(verifyStripeSignature(body, header, secret, now).type).toBe(
      'checkout.session.completed',
    );
  });

  it('REFUSES a signature made with the wrong secret', () => {
    // The whole authentication of a public endpoint.
    const header = `t=${now},v1=${sign(body, now, 'whsec_someone_elses_secret')}`;
    expect(() => verifyStripeSignature(body, header, secret, now)).toThrow(/does not verify/);
  });

  it('REFUSES a payload altered after signing', () => {
    const header = `t=${now},v1=${sign(body, now)}`;
    const tampered = body.replace('evt_1', 'evt_2');
    expect(() => verifyStripeSignature(tampered, header, secret, now)).toThrow(/does not verify/);
  });

  it('REFUSES a replay outside the timestamp tolerance', () => {
    // A signature captured once must not work indefinitely.
    const old = now - 3600;
    const header = `t=${old},v1=${sign(body, old)}`;
    expect(() => verifyStripeSignature(body, header, secret, now)).toThrow(/tolerance/);
  });

  it('accepts a signature inside the tolerance, in both directions', () => {
    for (const skew of [-299, 299]) {
      const ts = now + skew;
      const header = `t=${ts},v1=${sign(body, ts)}`;
      expect(() => verifyStripeSignature(body, header, secret, now)).not.toThrow();
    }
  });

  it('accepts a header carrying SEVERAL v1 values — a secret rotation', () => {
    // Stripe sends one per active secret while a rotation is in flight.
    // Checking only the first breaks every rotation.
    const header = `t=${now},v1=${sign(body, now, 'whsec_old')},v1=${sign(body, now)}`;
    expect(() => verifyStripeSignature(body, header, secret, now)).not.toThrow();
  });

  it('refuses a missing header, a missing signature, and a missing secret', () => {
    expect(() => verifyStripeSignature(body, undefined, secret, now)).toThrow(/Missing/);
    expect(() => verifyStripeSignature(body, `t=${now}`, secret, now)).toThrow(/no v1/);
    expect(() => verifyStripeSignature(body, `v1=${sign(body, now)}`, secret, now)).toThrow(
      /no usable timestamp/,
    );
    expect(() => verifyStripeSignature(body, `t=${now},v1=x`, '', now)).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });

  it('refuses a garbage hex signature without throwing from timingSafeEqual', () => {
    // A length mismatch makes `timingSafeEqual` throw outright, which would
    // be a 500 instead of a refusal.
    const header = `t=${now},v1=nothexatall`;
    expect(() => verifyStripeSignature(body, header, secret, now)).toThrow(/does not verify/);
  });

  it('the simulator signs something this verifier accepts', async () => {
    // Ties the two halves together: the simulator is not merely asserted to
    // be faithful, its output is fed to the production verifier.
    const s = await sim();
    await providerFor(s).createCheckout(request);
    const { body: payload, signature } = s.pay(s.last()!.id);

    const event = verifyStripeSignature(payload, signature, s.webhookSecret);
    expect(event.type).toBe('checkout.session.completed');
    expect((event.data.object as { metadata: Record<string, string> }).metadata.purchase_id).toBe(
      request.purchaseId,
    );
  });

  it('a simulator signature made with the WRONG secret is refused', async () => {
    const s = await sim();
    await providerFor(s).createCheckout(request);
    const { body: payload, signature } = s.pay(s.last()!.id, { secret: 'whsec_not_ours' });

    expect(() => verifyStripeSignature(payload, signature, s.webhookSecret)).toThrow(
      /does not verify/,
    );
  });
});
