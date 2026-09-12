'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

const DECIMAL = /^\d+(\.\d{1,4})?$/;

export async function createGoal(
  workspaceId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();
  const targetDate = String(formData.get('targetDate') ?? '').trim();
  if (name === '') return { ok: false, message: 'Give the goal a name.' };
  if (!DECIMAL.test(target)) return { ok: false, message: 'Enter the target as a plain number, e.g. 2000.' };
  try {
    await api('/v1/goals', {
      method: 'POST',
      body: { name, target, targetDate: targetDate || undefined },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not start that goal.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function contributeToGoal(
  workspaceId: string,
  path: string,
  goalId: string,
  amount: string,
): Promise<ActionResult> {
  if (!DECIMAL.test(amount)) return { ok: false, message: 'Enter a plain number.' };
  try {
    await api(`/v1/goals/${goalId}/contribute`, {
      method: 'POST',
      body: { amount },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not add that contribution.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function deleteGoal(workspaceId: string, path: string, goalId: string): Promise<ActionResult> {
  try {
    await api(`/v1/goals/${goalId}`, { method: 'DELETE', workspaceId, idempotencyKey: newIdempotencyKey() });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not delete that goal.' };
  }
  revalidatePath(path);
  return { ok: true };
}
