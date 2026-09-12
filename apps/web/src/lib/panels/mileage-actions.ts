'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function addTrip(
  workspaceId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const date = String(formData.get('date') ?? '');
  const fromPlace = String(formData.get('fromPlace') ?? '').trim();
  const toPlace = String(formData.get('toPlace') ?? '').trim();
  const km = Number(formData.get('km'));
  const purpose = String(formData.get('purpose') ?? '').trim();
  const workRelated = formData.get('workRelated') === 'on';

  if (!DATE.test(date)) return { ok: false, message: 'Pick a date.' };
  if (fromPlace === '' || toPlace === '') return { ok: false, message: 'Where from and where to are both required.' };
  if (!Number.isFinite(km) || km <= 0) return { ok: false, message: 'Enter the distance in kilometres.' };

  try {
    await api('/v1/trips', {
      method: 'POST',
      body: { date, fromPlace, toPlace, km, purpose: purpose || undefined, workRelated, source: 'manual' },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not log that trip.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function deleteTrip(workspaceId: string, path: string, tripId: string): Promise<ActionResult> {
  try {
    await api(`/v1/trips/${tripId}`, { method: 'DELETE', workspaceId, idempotencyKey: newIdempotencyKey() });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not remove that trip.' };
  }
  revalidatePath(path);
  return { ok: true };
}
