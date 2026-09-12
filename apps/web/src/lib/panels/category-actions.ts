'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

export async function setCategoryActive(
  workspaceId: string,
  path: string,
  name: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await api(`/v1/settings/categories/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: { active },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not update that category.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function setBudget(
  workspaceId: string,
  path: string,
  category: string,
  monthly: string,
): Promise<ActionResult> {
  if (!/^\d+(\.\d{1,4})?$/.test(monthly)) {
    return { ok: false, message: 'Enter a plain number, e.g. 400 or 400.00.' };
  }
  try {
    await api('/v1/budgets', {
      method: 'PUT',
      body: { category, monthly },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not set that budget.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function createCategory(
  workspaceId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  const monthly = String(formData.get('monthly') ?? '').trim();
  if (name === '') return { ok: false, message: 'Give the category a name.' };
  try {
    await api('/v1/settings/categories', {
      method: 'POST',
      body: { name },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
    if (monthly !== '') {
      if (!/^\d+(\.\d{1,4})?$/.test(monthly)) {
        return { ok: false, message: 'Enter a plain number for the budget, e.g. 400.' };
      }
      await api('/v1/budgets', {
        method: 'PUT',
        body: { category: name, monthly },
        workspaceId,
        idempotencyKey: newIdempotencyKey(),
      });
    }
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not add that category.' };
  }
  revalidatePath(path);
  return { ok: true };
}
