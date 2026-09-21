import type { CheckoutSession, PaymentProviderId } from '@snap/api-contract';

import { simulationMode } from '../integrations/simulation.js';

/**
 * The seam a payment processor drops into.
 *
 * ── Why this exists before a processor does ────────────────────────────────
 *
 * The gateway is undecided, and the decision is bigger than picking a vendor:
 * charging through the phone puts the purchase under Apple's and Google's
 * in-app purchase rules, which is a different rail at a different rate, not a
 * different API key (`docs/MONETISATION.md` §1 prices it at 15–30% against
 * roughly 2% for cards). Writing the call sites against Stripe and swapping
 * later would mean rewriting them, because the shapes do not correspond:
 * Stripe hands back a hosted-page URL, StoreKit hands back a product
 * identifier the phone redeems itself.
 *
 * So the port returns a DESCRIPTOR of what to do next, which every rail can
 * answer, and the UI branches on the descriptor rather than on the vendor.
 *
 * ── What is deliberately NOT here, and what changed ───────────────────────
 *
 * No fake provider that "succeeds". A stub that completes a checkout would
 * make the buy button work in development and fail in production, which is the
 * failure mode this repository keeps re-learning: a thing that is green
 * everywhere except where it matters. Granting credits without money has
 * exactly one entry point — the manual fulfil endpoint — and that is gated in
 * `config.ts#isManualCreditFulfilmentEnabled` and tested to fail closed.
 *
 * THAT OBJECTION STILL STANDS, and `StripePaymentProvider` is not a
 * counter-example to it. The simulated Stripe (`docs/INTEGRATIONS.md` Lane P)
 * is not a `PaymentProvider` at all — it is an HTTP server that serves
 * Stripe's Checkout Sessions shape and signs its webhook with a real
 * HMAC-SHA256, so the provider talking to it is the same class, making the
 * same form-encoded call, and the same signature verification runs. Nothing
 * short-circuits: a simulated checkout still only grants credits by way of a
 * signature-verified webhook. See that document's §0 for the distinction
 * between a stub and a simulator, which this file's objection is what
 * prompted.
 *
 * ── Adding one ────────────────────────────────────────────────────────────
 *
 * Implement `PaymentProvider`, return `{ state: 'redirect', url }`, and select
 * it in `paymentProvider()`. Then write the webhook handler: it must call the
 * same `fulfilCreditPurchase` this codebase already has, keyed by `provider` +
 * `provider_ref` for idempotency — `credit_purchases` has both columns and a
 * unique index waiting for them. Do NOT grant credits from the redirect
 * return: the customer's browser coming back is not proof that money moved.
 */
export interface CheckoutRequest {
  purchaseId: string;
  tenantId: string;
  /**
   * Who is buying. Carried into the processor's metadata so the WEBHOOK can
   * re-enter this tenant's RLS context — that request arrives with no
   * session and no workspace, and without an identity to act as, granting
   * the credits would mean a cross-tenant write. See `stripe-provider.ts`.
   */
  userId: string;
  packCode: string;
  credits: number;
  /** Decimal string, GST-inclusive AUD. Never a float. */
  priceAud: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
}

/**
 * The provider in use while none is configured.
 *
 * It records the intent — the purchase row already exists by the time this is
 * called — and says plainly that there is nothing to pay with. That is the
 * truthful state, and it is the one the buy screen renders.
 */
export const noPaymentProvider: PaymentProvider = {
  id: 'none',
  async createCheckout({ purchaseId }: CheckoutRequest): Promise<CheckoutSession> {
    return {
      purchaseId,
      provider: 'none',
      state: 'unavailable',
      message:
        'Card payments are not connected yet, so nothing has been charged and no credits have been added. Your order is saved — we will email you when checkout opens.',
    };
  },
};

/**
 * Which provider to use.
 *
 * One function, so "how do we take money" has a single answer that is read
 * rather than assumed.
 *
 * ASYNC as of `docs/INTEGRATIONS.md` Lane P, for the same reason the mailer
 * became async in Lane N: the simulator is an HTTP server and does not have
 * an address until it is listening. Memoised as a promise so concurrent
 * requests share one provider — and one simulator — rather than each
 * starting their own, and cleared on rejection so a transient
 * misconfiguration does not poison the process for its lifetime.
 */
let cached: Promise<PaymentProvider> | null = null;

/**
 * The webhook secret for whichever Stripe is active.
 *
 * Held here because the webhook handler has no other way to learn it when
 * the simulator mints one at startup. For a real deployment it is simply
 * `STRIPE_WEBHOOK_SECRET`, and `stripeWebhookSecret()` returns that whether
 * or not a checkout has been created yet — a webhook can legitimately be the
 * first Stripe traffic a fresh process sees.
 */
let simulatedWebhookSecret: string | null = null;

export function paymentProvider(): Promise<PaymentProvider> {
  if (!cached) {
    cached = build().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

async function build(): Promise<PaymentProvider> {
  const mode = simulationMode('stripe');

  if (mode === 'absent') {
    // The truthful state, and the one the buy screen renders. NOT a silent
    // fallback to something that pretends: `noPaymentProvider` says plainly
    // that there is nothing to pay with, and nothing is charged or granted.
    return noPaymentProvider;
  }

  const { StripePaymentProvider } = await import('./stripe-provider.js');
  const webBase = process.env.WEB_PUBLIC_URL ?? 'http://127.0.0.1:3000';

  if (mode === 'real') {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      // Refused at selection rather than at the first webhook. Without this
      // secret a payment completes at Stripe and the credits are never
      // granted, because the handler cannot verify the callback — money
      // taken, nothing delivered, and the failure is invisible until a
      // customer complains.
      throw new Error(
        'STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. Credits are granted ONLY by a ' +
          'signature-verified webhook, so without it every completed payment would be taken and ' +
          'never fulfilled. Set it (Stripe dashboard → Webhooks → signing secret).',
      );
    }
    return new StripePaymentProvider({
      secretKey: process.env.STRIPE_SECRET_KEY!,
      successUrl: `${webBase}/credits/thanks`,
      cancelUrl: `${webBase}/credits`,
    });
  }

  // Simulated. The SAME class, pointed at a server that serves Stripe's
  // Checkout Sessions shape and signs its webhooks with a real HMAC — not a
  // second implementation, and nothing short-circuited. See the header.
  const { startStripeSimulator } = await import('../integrations/stripe-simulator.js');
  const sim = await startStripeSimulator();
  simulatedWebhookSecret = sim.webhookSecret;
  return new StripePaymentProvider({
    secretKey: sim.secretKey,
    apiBase: sim.apiBase,
    successUrl: `${webBase}/credits/thanks`,
    cancelUrl: `${webBase}/credits`,
  });
}

/** The secret the webhook handler must verify against. */
export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? simulatedWebhookSecret;
}

/** Test-only: drop the memoised provider so the next call re-reads the env. */
export function resetPaymentProviderForTesting(): void {
  cached = null;
  simulatedWebhookSecret = null;
}
