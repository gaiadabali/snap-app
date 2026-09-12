'use server';

import type { TaxPackFile } from '@snap/api-contract';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';
import { config } from '@/lib/config';

export async function prepareTaxPack(
  workspaceId: string,
): Promise<{ ok: true; file: TaxPackFile } | { ok: false; message: string }> {
  try {
    const file = await api<TaxPackFile>('/v1/tax-pack', {
      method: 'POST',
      body: {},
      workspaceId,
      idempotencyKey: newIdempotencyKey(),
    });
    // The server hands back a relative path so it works behind any host or
    // tunnel — made absolute here, the one place that knows the API origin.
    return { ok: true, file: { ...file, url: `${config.apiUrl}${file.url}` } };
  } catch (error) {
    return { ok: false, message: error instanceof ApiError ? error.message : 'Could not assemble the pack.' };
  }
}
