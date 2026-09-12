'use server';

import { revalidatePath } from 'next/cache';

import { newIdempotencyKey } from '@/lib/api/server';

import { triggerReextraction, type AdminJobRef } from '../../_data/governance';

export async function triggerReextractionAction(
  tenantId: string,
  captureId: string,
  reason: string,
): Promise<AdminJobRef> {
  const ref = await triggerReextraction(tenantId, captureId, reason, newIdempotencyKey());
  revalidatePath('/admin/operations');
  return ref;
}
