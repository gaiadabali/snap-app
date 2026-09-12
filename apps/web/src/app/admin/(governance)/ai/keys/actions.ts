'use server';

import { revalidatePath } from 'next/cache';

import { newIdempotencyKey } from '@/lib/api/server';

import {
  revokeAiKey,
  setAiProviderKey,
  upsertAiProvider,
  type AdminAiKeyRef,
} from '../../../_data/governance';

const PATH = '/admin/ai/keys';

/**
 * Creates a new provider config row (not a key — see `setAiProviderKeyAction`).
 * One idempotency key per submit, not per retry.
 */
export async function upsertAiProviderAction(input: {
  provider: string;
  label: string;
  defaultModel?: string | null;
}): Promise<void> {
  await upsertAiProvider({ ...input, isActive: true }, newIdempotencyKey());
  revalidatePath(PATH);
}

/**
 * Toggles `isActive` on an EXISTING provider config, via the same upsert the
 * server exposes (`ON CONFLICT (label) DO UPDATE`) — there is no separate
 * PATCH for just this field, so the whole row is resubmitted with one value
 * changed.
 */
export async function setProviderActiveAction(input: {
  provider: string;
  label: string;
  defaultModel: string | null;
  isActive: boolean;
}): Promise<void> {
  await upsertAiProvider(input, newIdempotencyKey());
  revalidatePath(PATH);
}

/**
 * Returns the `AdminAiKeyRef` (including `keyId`) so the calling component
 * can offer an immediate "revoke this" — see the governance data layer's
 * note on why that is the ONLY way a `keyId` ever reaches the client.
 */
export async function setAiProviderKeyAction(configId: string, apiKey: string): Promise<AdminAiKeyRef> {
  const ref = await setAiProviderKey(configId, apiKey, newIdempotencyKey());
  revalidatePath(PATH);
  return ref;
}

export async function revokeAiKeyAction(keyId: string, reason: string): Promise<void> {
  await revokeAiKey(keyId, reason, newIdempotencyKey());
  revalidatePath(PATH);
}
