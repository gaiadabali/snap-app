import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CheckoutSession } from '@snap/api-contract';

import type { CheckoutRequest, PaymentProvider } from './payment-provider.js';

/**
 * Stripe, as the `PaymentProvider` port already shaped it.
 *
 * `docs/INTEGRATIONS.md` Lane P. The port's header explains why it returns a
 * DESCRIPTOR rather than a vendor object — charging through the phone puts
 * the purchase under Apple's and Google's in-app purchase rules, a different
 * rail at 15–30% against roughly 2% for cards — so this returns
 * `{ state: 'redirect', url }` and the UI branches on the descriptor, not on
 * the word "Stripe".
 *
 * ── Why there is no `stripe` SDK dependency ───────────────────────────────
 *
 * Two calls are needed: create a Checkout Session, and verify a webhook
 * signature. Both are small, and writing them directly is what makes the
 * simulator worth having — the code that runs against a simulated Stripe is
 * then byte-for-byte the code that runs against the real one, including the
 * form encoding and the HMAC. An SDK would add a layer that the simulator
 * would have to be trusted to satisfy rather than one that is exercised.
 *
 * It also keeps `apps/server` free of a dependency that pulls its own HTTP
 * stack, which `test/boundaries.test.ts` exists to care about.
 *
 * ── Form encoding, because Stripe's API is not JSON ───────────────────────
 *
 * `POST /v1/checkout/sessions` takes
 * `application/x-www-form-urlencoded` with bracketed nested keys
 * (`line_items[0][price_data][unit_amount]`). Getting this wrong is the
 * most likely integration bug, and it is exactly what a simulator speaking
 * the real shape catches.
 */

const STRIPE_API = 'https://api.stripe.com';

/** Stripe's tolerance for webhook timestamp skew. Five minutes, as documented. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

export interface StripeOptions {
  secretKey: string;
  /** Overridden only by the simulator. Never set in a real deployment. */
  apiBase?: string;
  /** Where Stripe sends the customer back to. */
  successUrl: string;
  cancelUrl: string;
  timeoutMs?: number;
}

/**
 * Flatten to Stripe's bracketed form encoding.
 *
 * `{a: {b: 1}}` -> `a[b]=1`; arrays index numerically. Written out rather
 * than hand-building strings so a nested value cannot silently be dropped.
 */
function formEncode(value: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      parts.push(...formEncode(raw as Record<string, unknown>, name));
    } else if (Array.isArray(raw)) {
      raw.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(...formEncode(item as Record<string, unknown>, `${name}[${index}]`));
        } else {
          parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(raw))}`);
    }
  }
  return parts;
}

/**
 * A GST-inclusive AUD decimal string to integer cents.
 *
 * Stripe takes the smallest currency unit as an integer. `price_aud` is
 * `numeric(12,4)` and arrives as a decimal STRING — never a float, per this
 * codebase's money rule — so the conversion is done on the digits rather
 * than via `Number`, where 44.78 * 100 is 4477.999999999999.
 */
export function audToCents(priceAud: string): number {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(priceAud.trim());
  if (!match) throw new StripeError(`Not a decimal amount: "${priceAud}"`);
  const [, sign, whole, fraction = ''] = match;
  const cents = `${fraction}00`.slice(0, 2);
  // A third decimal place would be a real amount we cannot charge. Refused
  // rather than rounded: silently dropping a fraction of a cent from a price
  // is the kind of thing nobody notices until reconciliation.
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) {
    throw new StripeError(
      `${priceAud} AUD has sub-cent precision Stripe cannot charge; the price list must be cent-exact.`,
    );
  }
  const value = Number(`${whole}${cents}`);
  return sign === '-' ? -value : value;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  private readonly apiBase: string;

  constructor(private readonly options: StripeOptions) {
    if (!options.secretKey) throw new StripeError('STRIPE_SECRET_KEY is required.');
    this.apiBase = (options.apiBase ?? STRIPE_API).replace(/\/+$/, '');
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const body = formEncode({
      mode: 'payment',
      success_url: this.options.successUrl,
      cancel_url: this.options.cancelUrl,
      client_reference_id: request.purchaseId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: audToCents(request.priceAud),
            product_data: { name: `${request.credits} scans (${request.packCode})` },
          },
        },
      ],
      // METADATA IS THE ONLY THING THE WEBHOOK WILL HAVE.
      //
      // A webhook arrives unauthenticated — there is no session, no user and
      // no workspace on that request. The signature proves the payload came
      // from Stripe unmodified, and these three fields are what we put there
      // ourselves, so the handler can re-enter the tenant's RLS context to
      // grant the credits. Without them the handler would have to search
      // across tenants, which is precisely the cross-tenant read this schema
      // is built to make impossible.
      metadata: {
        purchase_id: request.purchaseId,
        tenant_id: request.tenantId,
        user_id: request.userId,
      },
    }).join('&');

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/v1/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // Stripe pins behaviour to an API version. Without this the
          // response shape changes under us whenever the account default
          // moves, which is a silent break.
          'Stripe-Version': '2025-08-27.basil',
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch (cause) {
      throw new StripeError(`Stripe could not be reached: ${String(cause)}. Nothing was charged.`);
    }

    const text = await response.text();
    let parsed: { url?: string; id?: string; error?: { message?: string } };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new StripeError(
        `Stripe returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`,
        response.status,
      );
    }

    if (!response.ok) {
      throw new StripeError(
        `Stripe refused to create a checkout session (HTTP ${response.status}): ${
          parsed.error?.message ?? text.slice(0, 200)
        }`,
        response.status,
      );
    }
    if (!parsed.url) {
      throw new StripeError('Stripe created a session with no URL to send the customer to.');
    }

    return { purchaseId: request.purchaseId, provider: 'stripe', state: 'redirect', url: parsed.url };
  }
}

export interface VerifiedStripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verify a `Stripe-Signature` header and parse the event.
 *
 * THIS IS THE ONLY THING STANDING BETWEEN A PUBLIC URL AND FREE CREDITS.
 * The webhook endpoint cannot be authenticated any other way — Stripe calls
 * it, not a signed-in user — so every property below is load-bearing:
 *
 *  * The signature is over `${timestamp}.${rawBody}`, so the RAW bytes must
 *    be verified, not a re-serialised object. A JSON round trip changes key
 *    order and whitespace and the HMAC no longer matches.
 *  * `timingSafeEqual`, not `===`: a byte-by-byte early return leaks the
 *    correct prefix to anyone who can measure it.
 *  * The timestamp is checked against a tolerance, so a signature captured
 *    once cannot be replayed indefinitely.
 *  * A header may carry SEVERAL `v1=` values during a secret rotation. Any
 *    one matching is a pass; checking only the first breaks every rotation.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifiedStripeEvent {
  if (!secret) throw new StripeError('STRIPE_WEBHOOK_SECRET is required to verify a webhook.');
  if (!header) throw new StripeError('Missing Stripe-Signature header.');

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key?.trim() === 't' && value) timestamp = Number(value.trim());
    if (key?.trim() === 'v1' && value) signatures.push(value.trim());
  }

  if (timestamp === undefined || Number.isNaN(timestamp)) {
    throw new StripeError('Stripe-Signature carried no usable timestamp.');
  }
  if (signatures.length === 0) {
    throw new StripeError('Stripe-Signature carried no v1 signature.');
  }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new StripeError(
      `Stripe-Signature timestamp is outside the ${SIGNATURE_TOLERANCE_SECONDS}s tolerance — replayed or badly skewed.`,
    );
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const matched = signatures.some((candidate) => {
    let provided: Buffer;
    try {
      provided = Buffer.from(candidate, 'hex');
    } catch {
      return false;
    }
    // Length must match before timingSafeEqual, which throws on a mismatch —
    // and the length itself is not a secret.
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });

  if (!matched) throw new StripeError('Stripe-Signature does not verify.');

  try {
    return JSON.parse(rawBody) as VerifiedStripeEvent;
  } catch {
    throw new StripeError('Webhook body verified but is not JSON.');
  }
}
