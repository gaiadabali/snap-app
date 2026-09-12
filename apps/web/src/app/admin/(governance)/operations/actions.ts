'use server';

import { revalidatePath } from 'next/cache';

import {
  currentOperatorLabel,
  previewPurge,
  previewReplay,
  retryFailedJobs,
  triggerPurge,
  triggerReplay,
  type ReplayPreview,
  type ReplayScope,
} from '../../_data/governance';

export async function previewReplayAction(
  scope: ReplayScope,
  opts: { tenantId?: string; modelId?: string },
): Promise<ReplayPreview> {
  return previewReplay(scope, opts);
}

export async function triggerReplayAction(
  scope: ReplayScope,
  opts: { tenantId?: string; modelId?: string },
  confirmationPhrase: string,
): Promise<void> {
  await triggerReplay(scope, opts, confirmationPhrase, currentOperatorLabel());
  revalidatePath('/admin/operations');
}

export async function previewPurgeAction() {
  return previewPurge();
}

export async function triggerPurgeAction(confirmationPhrase: string): Promise<void> {
  await triggerPurge(confirmationPhrase, currentOperatorLabel());
  revalidatePath('/admin/operations');
}

export async function retryFailedJobsAction(jobType: string): Promise<void> {
  await retryFailedJobs(jobType, currentOperatorLabel());
  revalidatePath('/admin/operations');
}
