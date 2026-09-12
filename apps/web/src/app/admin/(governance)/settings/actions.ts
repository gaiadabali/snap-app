'use server';

import { revalidatePath } from 'next/cache';

import {
  currentOperatorLabel,
  removeAnnouncementBanner,
  setExtractionThreshold,
  setFeatureFlag,
  setMaintenanceMode,
  setValidatorToggle,
  updatePlanDefault,
  updateSupportConfig,
  upsertAnnouncementBanner,
  type AnnouncementBanner,
  type MaintenanceMode,
  type PlanQuotaDefault,
  type SupportConfig,
} from '../../_data/governance';

const PATH = '/admin/settings';

export async function setFeatureFlagAction(key: string, enabled: boolean): Promise<void> {
  await setFeatureFlag(key, enabled, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function setExtractionThresholdAction(key: string, value: number): Promise<void> {
  await setExtractionThreshold(key, value, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function setValidatorToggleAction(key: string, enabled: boolean): Promise<void> {
  await setValidatorToggle(key, enabled, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function setMaintenanceModeAction(patch: Partial<MaintenanceMode>): Promise<void> {
  await setMaintenanceMode(patch, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function upsertAnnouncementBannerAction(banner: AnnouncementBanner): Promise<void> {
  await upsertAnnouncementBanner(banner, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function removeAnnouncementBannerAction(id: string): Promise<void> {
  await removeAnnouncementBanner(id, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function updateSupportConfigAction(patch: Partial<SupportConfig>): Promise<void> {
  await updateSupportConfig(patch, currentOperatorLabel());
  revalidatePath(PATH);
}

export async function updatePlanDefaultAction(planCode: string, patch: Partial<PlanQuotaDefault>): Promise<void> {
  await updatePlanDefault(planCode, patch, currentOperatorLabel());
  revalidatePath(PATH);
}
