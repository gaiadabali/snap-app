'use server';

import { revalidatePath } from 'next/cache';

import {
  currentOperatorLabel,
  getRouting,
  setEscalationOrder,
  setModelEnabled,
  setPrimaryModel,
  type Capability,
} from '../../../_data/governance';

export async function setPrimaryModelAction(capability: Capability, modelId: string): Promise<void> {
  await setPrimaryModel(capability, modelId, currentOperatorLabel());
  revalidatePath('/admin/ai/models');
}

export async function setModelEnabledAction(modelId: string, enabled: boolean): Promise<void> {
  await setModelEnabled(modelId, enabled, currentOperatorLabel());
  revalidatePath('/admin/ai/models');
}

export async function moveEscalationAction(
  capability: Capability,
  modelId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const routing = await getRouting();
  const order = [...routing[capability].escalationOrder];
  const idx = order.indexOf(modelId);
  if (idx === -1) return;
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= order.length) return;
  const tmp = order[idx]!;
  order[idx] = order[swapWith]!;
  order[swapWith] = tmp;
  await setEscalationOrder(capability, order, currentOperatorLabel());
  revalidatePath('/admin/ai/models');
}
