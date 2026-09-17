import type { CheckoutSession, PaymentProviderId } from '@snap/api-contract';

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
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * No fake provider that "succeeds". A stub that completes a checkout would
 * make the buy button work in development and fail in production, which is the
 * failure mode this repository keeps re-learning: a thing that is green
 * everywhere except where it matters. Granting credits without money has
 * exactly one entry point — the manual fulfil endpoint — and that is gated in
 * `config.ts#isManualCreditFulfilmentEnabled` and tested to fail closed.
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
 * rather than assumed. Today there is one branch; when a processor is chosen
 * this is where it is selected, and every call site already handles both
 * descriptor states.
 */
export function paymentProvider(): PaymentProvider {
  return noPaymentProvider;
}
