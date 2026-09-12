'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * Workspace settings — one action for both kinds.
 *
 * A personal workspace's form never even shows the ABN/GST fields (see
 * `SettingsForm`), so this only ever sends what the form actually carried;
 * the server refuses an ABN or GST flag on a personal tenant regardless, but
 * the UI should not offer a control it knows will be rejected.
 */
export async function updateSettings(
  workspaceId: string,
  path: string,
  isBusiness: boolean,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const body: Record<string, unknown> = {
    name: String(formData.get('name') ?? '').trim() || undefined,
  };
  if (isBusiness) {
    const abn = String(formData.get('abn') ?? '').trim();
    body.abn = abn === '' ? null : abn;
    body.gstRegistered = formData.get('gstRegistered') === 'on';
    body.gstBasis = String(formData.get('gstBasis') ?? 'cash');
    body.simplerBas = formData.get('simplerBas') === 'on';
  }
  const occupationProfileId = String(formData.get('occupationProfileId') ?? '');
  if (occupationProfileId !== '') body.occupationProfileId = occupationProfileId;

  try {
    await api('/v1/settings/business', {
      method: 'PATCH',
      body,
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not save settings.' };
  }
  revalidatePath(path);
  return { ok: true };
}
