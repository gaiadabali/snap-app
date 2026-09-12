'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { api, SESSION_COOKIE, WORKSPACE_COOKIE, newIdempotencyKey } from '@/lib/api/server';

/**
 * Switches the active workspace.
 *
 * The one place a panel page writes the workspace cookie — everywhere else
 * only reads it. Bound with the destination path from the caller (a plain
 * server action cannot know which page invoked it), so switching from the
 * business ledger back to a different business workspace re-renders the
 * ledger, not the panel root.
 */
export async function switchWorkspace(path: string, workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath(path);
}

/**
 * Signs out.
 *
 * There is no server call to make — a session here is a signed, stateless
 * token (§ the mobile client's own `signOut`), so forgetting the cookies IS
 * signing out. Clears the workspace choice too: leaving it would hand the
 * next person to sign in on this browser someone else's last-viewed
 * workspace for a moment before they pick their own.
 */
export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(WORKSPACE_COOKIE);
  redirect('/');
}

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * The one path into a workspace kind this person does not have yet.
 *
 * Deliberately NOT the full onboarding wizard — that is `/register`'s job
 * (a different owner, `docs/WEB.md` §5). This exists so landing on `/app` or
 * `/app/business` with nothing of that kind is a real form with one field,
 * never a dead end or a page that only says "coming soon".
 */
export async function createWorkspace(
  kind: 'business' | 'personal',
  path: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') return { ok: false, message: 'Give it a name.' };
  try {
    await api('/v1/workspaces', {
      method: 'POST',
      body: { name, kind },
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not create that workspace.',
    };
  }
  revalidatePath(path);
  return { ok: true };
}
