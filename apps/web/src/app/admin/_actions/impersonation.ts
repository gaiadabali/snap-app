'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { endImpersonation, ImpersonationError, startImpersonation } from '../_data/impersonation';
import { getActiveImpersonationSession, IMPERSONATION_COOKIE } from '../_lib/impersonation-cookie';

export type StartImpersonationFormState = { error: string | null };

/**
 * Starts an impersonation session from the confirmation page's form.
 *
 * The reason field is required and never pre-filled — docs/WEB.md §6 point 3
 * — so this rejects a blank or trivially short one server-side rather than
 * trusting the `required` attribute on the textarea.
 */
export async function startImpersonationAction(
  _prev: StartImpersonationFormState,
  formData: FormData,
): Promise<StartImpersonationFormState> {
  const subjectUserId = String(formData.get('subjectUserId') ?? '');
  const reason = String(formData.get('reason') ?? '');
  let session;
  try {
    session = await startImpersonation({ subjectUserId, reason });
  } catch (err) {
    if (err instanceof ImpersonationError) return { error: err.message };
    throw err;
  }

  const jar = await cookies();
  jar.set(IMPERSONATION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    expires: new Date(session.expiresAt),
  });

  redirect(session.tenantId ? `/admin/tenants/${session.tenantId}` : `/admin/people/${session.subjectUserId}`);
}

/** One-click exit, called from the persistent banner on every admin page. */
export async function endImpersonationAction(): Promise<void> {
  const active = await getActiveImpersonationSession();
  if (active) await endImpersonation(active.id, 'staff');
  const jar = await cookies();
  jar.delete(IMPERSONATION_COOKIE);
  redirect('/admin');
}
