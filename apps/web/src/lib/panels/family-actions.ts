'use server';

import { revalidatePath } from 'next/cache';
import type { TeenInviteCreated } from '@snap/api-contract';

import { api, ApiError } from '@/lib/api/server';

/**
 * Invite a teen, and end a teen's access (`/v1/family`, group 3.10). A
 * failure carries the server's own sentence: every refusal there is fixed
 * SnapApp copy (`family.controller.ts`).
 */
export type FamilyActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

const failed = (error: unknown, fallback: string) => ({
  ok: false as const,
  message: error instanceof ApiError && error.message ? error.message : fallback,
});

/** Made in the active workspace: its credits pay for the teen's scans. */
export async function createTeenInvite(workspaceId: string, path: string): Promise<FamilyActionResult<TeenInviteCreated>> {
  try {
    const value = await api<TeenInviteCreated>('/v1/family/invites', { method: 'POST', workspaceId });
    revalidatePath(path);
    return { ok: true, value };
  } catch (error) {
    return failed(error, 'Could not make an invite. Try again.');
  }
}

export async function endTeenAccess(path: string, teenWorkspaceId: string): Promise<FamilyActionResult<null>> {
  try {
    await api(`/v1/family/teens/${encodeURIComponent(teenWorkspaceId)}/end`, { method: 'POST' });
    revalidatePath(path);
    return { ok: true, value: null };
  } catch (error) {
    return failed(error, 'Could not end access. Try again.');
  }
}
