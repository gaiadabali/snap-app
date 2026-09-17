'use server';

import { revalidatePath } from 'next/cache';

import type { CheckoutSession, CreditPurchase } from '@snap/api-contract';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * Starts a credit purchase.
 *
 * Records intent and comes back `pending`. Taking money is a second step —
 * `beginCheckout` below — because the purchase record must exist before
 * anything is asked to charge against it, and because which rail that will be
 * is undecided.
 */
export async function startCreditPurchase(
  workspaceId: string,
  path: string,
  packCode: string,
): Promise<ActionResult> {
  try {
    await api('/v1/credits/purchases', {
      method: 'POST',
      body: { packCode },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : 'Could not start that purchase.',
    };
  }
  revalidatePath(path);
  return { ok: true };
}

/**
 * Asks what happens next about a pending purchase.
 *
 * Returns the server's descriptor rather than a boolean, because the honest
 * answer today is neither success nor failure: the order is recorded and there
 * is nothing to pay with. The buy screen renders that state in words instead
 * of offering a button that goes nowhere (`docs/WEB.md` §3.5).
 *
 * When a processor exists this returns `state: 'redirect'` and the caller
 * sends the customer to `url`. Credits are NOT granted on their return — the
 * browser coming back is not proof that money moved; the processor's webhook
 * is.
 */
export async function beginCheckout(
  workspaceId: string,
  purchaseId: string,
): Promise<{ ok: true; session: CheckoutSession } | { ok: false; message: string }> {
  try {
    const session = await api<CheckoutSession>(
      `/v1/credits/purchases/${encodeURIComponent(purchaseId)}/checkout`,
      {
        method: 'POST',
        workspaceId,
        idempotencyKey: newIdempotencyKey(),
      },
    );
    return { ok: true, session };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : 'Could not reach checkout.',
    };
  }
}

/**
 * The buy flow, as one server round trip: record the order, then ask what to
 * do about paying for it.
 *
 * Two server calls rather than one endpoint because the purchase record must
 * exist before anything is asked to charge against it — a payment that cannot
 * be reconciled to an order that was already priced and stored is how money
 * goes missing. But they are one ACTION, so the browser never holds a
 * half-finished purchase and never has to go looking for the id it just
 * created.
 *
 * Returns the descriptor untouched. Today it always says `unavailable`, which
 * the UI renders as words; when a processor exists it says `redirect` and the
 * caller sends the customer onward.
 */
export async function purchaseCredits(
  workspaceId: string,
  path: string,
  packCode: string,
): Promise<{ ok: true; session: CheckoutSession } | { ok: false; message: string }> {
  let purchase: CreditPurchase;
  try {
    purchase = await api<CreditPurchase>('/v1/credits/purchases', {
      method: 'POST',
      body: { packCode },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiError ? error.message : 'Could not start that purchase.',
    };
  }

  // The order is saved from here on. Anything that fails below must say so
  // without implying the purchase did not happen.
  revalidatePath(path);

  const result = await beginCheckout(workspaceId, purchase.id);
  if (!result.ok) {
    return {
      ok: false,
      message:
        'Your order was saved, but we could not reach checkout just now. It is in your purchase history as pending.',
    };
  }
  return result;
}
