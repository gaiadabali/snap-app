'use server';

import { revalidatePath } from 'next/cache';

import { newIdempotencyKey } from '@/lib/api/server';

import { resolveYourtalReview } from '../../../_data/governance';

export async function resolveYourtalReviewAction(id: string, resolution: string): Promise<void> {
  await resolveYourtalReview(id, resolution, newIdempotencyKey());
  revalidatePath('/admin/operations/yourtal-reviews');
}
