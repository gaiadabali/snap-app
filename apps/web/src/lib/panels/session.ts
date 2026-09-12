import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { AuthUser, WorkspaceSummary } from '@snap/api-contract';

import { api, ApiError, getSessionToken } from '@/lib/api/server';
import { getPanelImpersonation, isImpersonationEndedError, type ImpersonationBannerInfo } from './impersonation';

/**
 * Who is signed in, for the panels — the SUBJECT while a staff member is
 * impersonating, since `SessionGuard` on the other end resolves `X-Impersonation-Token`
 * to them, not to the staff member holding it.
 *
 * Every panel page needs this before it does anything else. Deliberately a
 * redirect rather than a thrown error: an expired or missing session is the
 * single most common reason a page render fails here, and a redirect to
 * sign-in is the only useful response to it — an error boundary would just
 * show a signed-in person's own dashboard as broken. An impersonation
 * session that died mid-browse gets its OWN redirect, to a page that
 * explains that rather than looking like a broken sign-in.
 *
 * Memoised with React's `cache()` so a layout and every page under it share
 * one round trip to `/v1/auth/session` per request instead of one each.
 */
export const requireSession = cache(
  async (): Promise<{ user: AuthUser; workspaces: WorkspaceSummary[]; impersonation: ImpersonationBannerInfo | null }> => {
    const impersonation = await getPanelImpersonation();
    // Under impersonation there is no ordinary bearer for the SUBJECT — the
    // impersonation token is the entire credential — so the usual "no
    // session token, straight to sign-in" bail-out must not fire just
    // because `token` is unset while a live impersonation cookie is doing
    // the same job.
    const token = await getSessionToken();
    if (!token && !impersonation) redirect('/sign-in?next=/app');

    try {
      const session = await api<{
        user: AuthUser;
        workspaces: Array<{ id: string; name: string; kind: 'business' | 'personal'; role: string }>;
      }>('/v1/auth/session');
      // The session endpoint answers with the same fields as `/v1/workspaces`
      // (a member count is not one of them), which is enough for every place
      // that only needs to know which workspaces exist and what kind they are.
      const workspaces: WorkspaceSummary[] = session.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        kind: w.kind,
        role: w.role as WorkspaceSummary['role'],
        memberCount: 0,
        abn: null,
      }));
      return { user: session.user, workspaces, impersonation };
    } catch (error) {
      if (isImpersonationEndedError(error)) {
        redirect('/app/impersonation-ended');
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        redirect('/sign-in?next=/app');
      }
      throw error;
    }
  },
);
