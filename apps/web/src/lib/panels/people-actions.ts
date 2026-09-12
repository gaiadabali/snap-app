'use server';

import { revalidatePath } from 'next/cache';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

export async function inviteMember(
  workspaceId: string,
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? 'member');
  if (email === '') return { ok: false, message: 'Enter an email address.' };
  try {
    await api(`/v1/workspaces/${workspaceId}/invitations`, {
      method: 'POST',
      body: { email, role },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not send that invitation.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function revokeInvitation(workspaceId: string, path: string, invitationId: string): Promise<ActionResult> {
  try {
    await api(`/v1/workspaces/${workspaceId}/invitations/${invitationId}`, {
      method: 'DELETE',
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not revoke that invitation.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function updateMemberRole(
  workspaceId: string,
  path: string,
  userId: string,
  role: string,
): Promise<ActionResult> {
  try {
    await api(`/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not change that role.' };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function removeMember(workspaceId: string, path: string, userId: string): Promise<ActionResult> {
  try {
    await api(`/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not remove them.' };
  }
  revalidatePath(path);
  return { ok: true };
}
