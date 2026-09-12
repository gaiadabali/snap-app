'use server';

import { revalidatePath } from 'next/cache';
import type { Connection } from '@snap/api-contract';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import type { ActionResult } from './actions';

/**
 * Beginning a connection returns a URL to authorise, never a connected state.
 * The server refuses outright when the provider has no client id configured
 * on this deployment (`SettingsController#connect`) — that refusal is shown
 * verbatim rather than papered over, because a stub that claimed success
 * would tell someone their receipts are flowing into Xero when nothing is.
 */
export async function connectAccounting(
  workspaceId: string,
  path: string,
  id: Connection['id'],
): Promise<ActionResult & { authorizeUrl?: string }> {
  try {
    const result = await api<{ authorizeUrl: string }>(`/v1/connections/${id}/connect`, {
      method: 'POST',
      body: {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
    revalidatePath(path);
    return { ok: true, authorizeUrl: result.authorizeUrl };
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not start that connection.' };
  }
}

export async function disconnectAccounting(
  workspaceId: string,
  path: string,
  id: Connection['id'],
): Promise<ActionResult> {
  try {
    await api(`/v1/connections/${id}/disconnect`, {
      method: 'POST',
      body: {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not disconnect that.' };
  }
  revalidatePath(path);
  return { ok: true };
}
