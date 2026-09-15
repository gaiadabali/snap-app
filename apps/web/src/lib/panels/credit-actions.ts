'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * Starts a credit purchase.
 *
 * There is no checkout to redirect to — Stripe is phase 6.5 and unwired
 * (`docs/ECOSYSTEM.md` D27) — so this only ever records intent and comes
 * back `pending`. The purchase history on the credits page is the honest
 * whole truth about what happens next: fulfilment is a manual step, not
 * something this action can promise.
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
