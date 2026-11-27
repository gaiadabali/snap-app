'use server';

import { revalidatePath } from 'next/cache';
import type { GodConsentState, GodTeenConsent } from '@snap/api-contract';

import { api, ApiError } from '@/lib/api/server';

/**
 * The GOD Group Privacy Notice (`/v1/god-consent`, god/TASKS.md 9.1.d). A failure
 * carries the server's own sentence; every refusal there is fixed SnapApp copy.
 */
export type GodActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

const failed = (error: unknown, fallback: string) => ({
  ok: false as const,
  message: error instanceof ApiError && error.message ? error.message : fallback,
});

/** An existing account's answer at next sign-in: accepted, or "Not now" (declined). */
export async function answerGodConsent(
  decision: 'accepted' | 'declined',
  version: string,
): Promise<GodActionResult<GodConsentState>> {
  try {
    const value = await api<GodConsentState>('/v1/god-consent', { method: 'POST', body: { decision, version } });
    revalidatePath('/app', 'layout');
    return { ok: true, value };
  } catch (error) {
    return failed(error, 'Could not save your answer. Try again.');
  }
}

/** "Stop combining my data with GOD". */
export async function withdrawGodConsent(): Promise<GodActionResult<{ withdrawn: boolean }>> {
  try {
    const value = await api<{ withdrawn: boolean }>('/v1/god-consent/withdraw', { method: 'POST' });
    revalidatePath('/app', 'layout');
    return { ok: true, value };
  } catch (error) {
    return failed(error, 'Could not record your request. Try again.');
  }
}

/** The parent's answer for a teen of theirs. */
export async function answerGodConsentForTeen(
  path: string,
  teenWorkspaceId: string,
  decision: 'accepted' | 'withdrawn',
  version: string,
): Promise<GodActionResult<GodTeenConsent>> {
  try {
    const value = await api<GodTeenConsent>(`/v1/family/teens/${encodeURIComponent(teenWorkspaceId)}/god-consent`, {
      method: 'POST',
      body: { decision, version },
    });
    revalidatePath(path);
    return { ok: true, value };
  } catch (error) {
    return failed(error, 'Could not save your answer. Try again.');
  }
}
