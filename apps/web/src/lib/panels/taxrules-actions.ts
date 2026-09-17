'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * Install a tax engine, replacing whatever the workspace is running.
 *
 * One engine at a time. Changing country is not a preference — it replaces the
 * rules every figure in the workspace is computed under, and the server moves
 * the country, base currency and financial-year start along with it so the two
 * cannot disagree.
 *
 * `revalidatePath` covers more than the settings page on purpose: the spending
 * screens print the tax's local name and its disclosure sentence, and both come
 * from the engine. A stale cache after a switch would show Indonesian totals
 * labelled GST.
 */
export async function installTaxRules(
  workspaceId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const rulesId = String(formData.get('rulesId') ?? '').trim();
  if (rulesId === '') {
    return { ok: false, message: 'Choose a country first.' };
  }

  try {
    await api('/v1/tax-rules', {
      method: 'PUT',
      body: { rulesId },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    // A 422 here is the engine refusing the rule set, and its message names
    // what is wrong with it. Surfacing that beats "could not save".
    return {
      ok: false,
      message:
        error instanceof ApiError
          ? error.message
          : 'Could not install that tax engine.',
    };
  }

  revalidatePath(path);
  revalidatePath('/app');
  revalidatePath('/app/analytics');
  return { ok: true };
}
