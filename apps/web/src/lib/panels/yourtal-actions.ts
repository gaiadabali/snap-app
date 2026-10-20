'use server';

import { revalidatePath } from 'next/cache';
import type { YourtalLinkStatus } from '@snap/api-contract';

import { api, ApiError, newIdempotencyKey } from '@/lib/api/server';

/**
 * Link and unlink YourTal (`POST` / `DELETE /v1/yourtal/link`).
 *
 * A failure is returned as the server's `error` code, not its message: the
 * page words each code itself (`lib/yourtal-link.ts`) so the sentence is the
 * same on the website and in the app. `code` is null when there is no code to
 * read, which is a network failure or an answer that is not ours.
 */
export type YourtalActionResult =
  | { ok: true; status: YourtalLinkStatus }
  | { ok: false; code: string | null };

/** `{ error, message }` is the shape the link endpoints answer with. */
function codeOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body;
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const code = (body as { error: unknown }).error;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

export async function linkYourtal(path: string, code: string): Promise<YourtalActionResult> {
  try {
    const status = await api<YourtalLinkStatus>('/v1/yourtal/link', {
      method: 'POST',
      body: { code },
      idempotencyKey: newIdempotencyKey(),
    });
    revalidatePath(path);
    return { ok: true, status };
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
}

export async function unlinkYourtal(path: string): Promise<YourtalActionResult> {
  try {
    const status = await api<YourtalLinkStatus>('/v1/yourtal/link', {
      method: 'DELETE',
      idempotencyKey: newIdempotencyKey(),
    });
    revalidatePath(path);
    return { ok: true, status };
  } catch (error) {
    return { ok: false, code: codeOf(error) };
  }
}
