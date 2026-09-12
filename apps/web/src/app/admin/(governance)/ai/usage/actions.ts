'use server';

import { revalidatePath } from 'next/cache';

import { currentOperatorLabel, setBudgetCap } from '../../../_data/governance';

export async function setBudgetCapAction(
  id: string,
  monthlyCapUsd: number,
  alertThresholdPct: number,
): Promise<void> {
  await setBudgetCap(id, { monthlyCapUsd, alertThresholdPct }, currentOperatorLabel());
  revalidatePath('/admin/ai/usage');
}
