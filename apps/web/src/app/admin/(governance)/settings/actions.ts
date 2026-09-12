'use server';

import { revalidatePath } from 'next/cache';

import { newIdempotencyKey } from '@/lib/api/server';

import { setPlatformSetting, type AdminPlatformSetting } from '../../_data/governance';

const PATH = '/admin/settings';

/**
 * `value` arrives already parsed (the caller does `JSON.parse` on whatever
 * was typed and only calls this if that succeeded) — this file never parses
 * untrusted JSON itself so a malformed edit fails in the component, with the
 * raw text still in the textarea, rather than as an opaque server error.
 */
export async function setPlatformSettingAction(
  key: string,
  value: unknown,
  reason: string,
): Promise<AdminPlatformSetting> {
  const result = await setPlatformSetting(key, value, reason, newIdempotencyKey());
  revalidatePath(PATH);
  return result;
}
