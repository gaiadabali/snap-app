'use server';

import { redirect } from 'next/navigation';

import { ApiError } from '../_data/client';
import { getAdminSession, ImpersonationError, startImpersonation, stopImpersonation } from '../_data/impersonation';
import { clearActiveImpersonation, getActiveImpersonationSession, setActiveImpersonation } from '../_lib/impersonation-cookie';

export type StartImpersonationFormState = { error: string | null };

/**
 * Starts a real impersonation session from the confirmation page's form.
 *
 * `subjectTenantId` travels as a hidden field rather than being looked up
 * here: there is no endpoint that maps a user to their tenant memberships
 * (see `_data/people.ts`), so the confirm page has the staff member pick the
 * tenant explicitly by search, and this action trusts nothing about that
 * pair beyond what it sends on — `admin_impersonation_start` itself refuses
 * the request if the user is not actually a member of that tenant.
 */
export async function startImpersonationAction(
  _prev: StartImpersonationFormState,
  formData: FormData,
): Promise<StartImpersonationFormState> {
  const subjectUserId = String(formData.get('subjectUserId') ?? '');
  const subjectTenantId = String(formData.get('subjectTenantId') ?? '');
  const subjectLabel = String(formData.get('subjectLabel') ?? 'this user');
  const subjectEmailRaw = String(formData.get('subjectEmail') ?? '');
  const tenantName = String(formData.get('tenantName') ?? 'this tenant');
  const reason = String(formData.get('reason') ?? '');

  const session = await getAdminSession();
  if (!session.allowed) {
    return { error: 'Your staff session could not be verified. Reload and sign in again.' };
  }

  let started;
  try {
    started = await startImpersonation({ subjectUserId, subjectTenantId, reason });
  } catch (err) {
    if (err instanceof ImpersonationError) return { error: err.message };
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }

  await setActiveImpersonation({
    sessionId: started.sessionId,
    token: started.token,
    staffId: session.data.staffId,
    // `AdminSession` now carries the signed-in staff member's own
    // display name/email (migration 0023's `admin_my_capabilities`) — falls
    // back to role + id prefix only for a staff row with no `display_name`
    // on file, which `users.display_name` allows to be null.
    staffName: session.data.displayName ?? session.data.email ?? `${session.data.role} · ${session.data.staffId.slice(0, 8)}`,
    subjectUserId,
    subjectName: subjectLabel,
    subjectEmail: subjectEmailRaw || null,
    tenantId: subjectTenantId,
    tenantName,
    reason: reason.trim(),
    startedAt: new Date().toISOString(),
    expiresAt: started.expiresAt,
  });

  redirect(`/admin/tenants/${subjectTenantId}`);
}

/** One-click exit, called from the persistent banner on every admin page. */
export async function endImpersonationAction(): Promise<void> {
  const active = await getActiveImpersonationSession();
  if (active) {
    try {
      await stopImpersonation(active.sessionId);
    } catch (err) {
      // Already ended (expired, or stopped from another tab) is not a
      // failure worth blocking the exit click on — the cookie still clears.
      if (!(err instanceof ApiError)) throw err;
    }
  }
  await clearActiveImpersonation();
  redirect('/admin');
}
