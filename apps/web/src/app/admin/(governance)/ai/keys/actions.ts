'use server';

import { revalidatePath } from 'next/cache';

import { currentOperatorLabel, setApiKey } from '../../../_data/governance';

export async function setApiKeyAction(providerId: string, rawKey: string): Promise<void> {
  await setApiKey(providerId, rawKey, currentOperatorLabel());
  revalidatePath('/admin/ai/keys');
  // `rawKey` goes out of scope here and is never returned, logged, or stored —
  // `setApiKey` reduced it to a prefix and a last-4 before this call returned.
}
