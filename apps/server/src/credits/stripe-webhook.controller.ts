import { BadRequestException, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { fulfilCreditPurchaseFromProvider, CreditPurchaseNotPendingError } from './credits.repo.js';
import { stripeWebhookSecret } from './payment-provider.js';
import { StripeError, verifyStripeSignature } from './stripe-provider.js';

/**
 * The only thing in this system that turns money into credits.
 *
 * `docs/INTEGRATIONS.md` Lane P, ticket P2, and the instruction in
 * `credits/payment-provider.ts`:
 *
 *   "Do NOT grant credits from the redirect return: the customer's browser
 *    coming back is not proof that money moved."
 *
 * That is why this endpoint exists and why `/credits/thanks` does nothing
 * but say thank you. A browser redirect is a URL the customer can type.
 *
 * ── This route is public, and that is not a mistake ──────────────────────
 *
 * Stripe calls it, not a signed-in user, so there is no session to require.
 * The signature IS the authentication: an HMAC-SHA256 over
 * `${timestamp}.${rawBody}` with a secret only Stripe and this server hold.
 * Everything downstream — which tenant, which purchase, which user to act
 * as — comes out of a payload that HMAC has already vouched for.
 *
 * ── The raw body matters ─────────────────────────────────────────────────
 *
 * The signature covers the exact bytes Stripe sent. Verifying a
 * re-serialised object fails, because `JSON.parse` then `JSON.stringify`
 * changes key order and whitespace. `main.ts` keeps the raw string for this
 * one route; see the parser there.
 *
 * ── Why it answers 200 to things that went wrong ─────────────────────────
 *
 * Stripe retries any non-2xx until it gives up. So the status code here is
 * not "did it work", it is "should Stripe send this again":
 *
 *   400 — the signature did not verify. Never retry; it will never verify.
 *   200 — verified, and we are done with it, INCLUDING the cases where
 *         there was nothing to do (an event type we ignore, an already-paid
 *         purchase, a purchase that no longer exists). Retrying those
 *         forever achieves nothing and buries the real failures.
 *   500 — verified, but WE failed (the database was down). Retry is exactly
 *         right, and Stripe's backoff is better than any we would write.
 */
@ApiTags('credits')
@Controller('v1/credits/webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger('stripe-webhook');

  @Post('stripe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe webhook — the only path that grants paid credits',
    description:
      'Public by necessity: Stripe calls it. Authentication is the Stripe-Signature HMAC over the raw body, ' +
      'verified before anything is read. Idempotent on (provider, provider_ref) and on an already-paid purchase, ' +
      'because Stripe retries until it gets a 2xx.',
  })
  async stripe(
    @Req()
    request: {
      rawBody?: string;
      headers: Record<string, string | string[] | undefined>;
    },
  ): Promise<{ received: true }> {
    const secret = stripeWebhookSecret();
    if (!secret) {
      // No secret configured means no webhook can ever be trusted. 400, not
      // 500: retrying will not conjure a secret, and a queue of retries
      // would hide the misconfiguration rather than surface it.
      this.logger.error('a Stripe webhook arrived but no STRIPE_WEBHOOK_SECRET is configured');
      throw new BadRequestException('Webhooks are not configured.');
    }

    const header = request.headers['stripe-signature'];
    const raw = request.rawBody;
    if (typeof raw !== 'string') {
      // The raw body is kept by a parser in main.ts. If it is missing, that
      // wiring has been changed and every webhook would silently fail to
      // verify — which would look exactly like an attack.
      this.logger.error('the raw request body was not captured; check the parser in main.ts');
      throw new BadRequestException('Malformed webhook.');
    }

    let event;
    try {
      event = verifyStripeSignature(raw, Array.isArray(header) ? header[0] : header, secret);
    } catch (error) {
      // Deliberately terse to the caller and specific in the log. An
      // attacker probing this endpoint learns only that it refused.
      this.logger.warn(
        `refused a webhook: ${error instanceof StripeError ? error.message : String(error)}`,
      );
      throw new BadRequestException('Signature verification failed.');
    }

    if (event.type !== 'checkout.session.completed') {
      // Verified and uninteresting. 200 so Stripe stops.
      return { received: true };
    }

    const session = event.data.object;
    const metadata = (session.metadata ?? {}) as Record<string, string>;
    const purchaseId = metadata.purchase_id;
    const tenantId = metadata.tenant_id;
    const userId = metadata.user_id;
    const providerRef = typeof session.id === 'string' ? session.id : null;

    if (!purchaseId || !tenantId || !userId || !providerRef) {
      // A completed session we cannot attribute. Logged loudly — money has
      // moved and nobody got credits — but 200, because no number of
      // retries will add the metadata this session was created without.
      this.logger.error(
        `checkout.session.completed ${String(session.id)} carries no usable metadata ` +
          '(purchase_id/tenant_id/user_id) — money may have moved with nothing granted',
      );
      return { received: true };
    }

    // Stripe reports the payment state separately from the session being
    // complete: an asynchronous method (BECS direct debit is the AU case)
    // completes the session while the payment is still `unpaid`. Granting
    // then would be granting on an intention.
    if (session.payment_status !== 'paid') {
      this.logger.log(
        `checkout.session.completed ${providerRef} is ${String(session.payment_status)}, not paid — nothing granted`,
      );
      return { received: true };
    }

    try {
      const row = await fulfilCreditPurchaseFromProvider(
        userId,
        tenantId,
        purchaseId,
        'stripe',
        providerRef,
      );
      if (!row) {
        this.logger.error(`webhook ${providerRef}: purchase ${purchaseId} does not exist`);
        return { received: true };
      }
      this.logger.log(`granted ${row.credits} credits for purchase ${purchaseId} (${providerRef})`);
    } catch (error) {
      if (error instanceof CreditPurchaseNotPendingError) {
        // refunded or failed. Not something a retry fixes.
        this.logger.error(`webhook ${providerRef}: purchase ${purchaseId} is ${error.status}`);
        return { received: true };
      }
      // Our failure. Rethrow so the response is 5xx and Stripe retries —
      // this is the one case where a retry is the correct outcome.
      throw error;
    }

    return { received: true };
  }
}
