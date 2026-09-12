import 'server-only';

import type { WorkspaceSummary } from '@snap/api-contract';

import { getImpersonation, ImpersonationEndedError, type ImpersonationCookiePayload } from '@/lib/api/server';

/**
 * The impersonation banner's data — everything customer-facing panel chrome
 * needs to announce "you are not looking at your own account" (docs/WEB.md
 * §6 point 4), derived from the cookie the admin console writes.
 *
 * A subset of `ImpersonationCookiePayload`, not the whole thing: `token` and
 * `sessionId` are for `api()` and the exit action to use, never for a
 * component to render.
 */
export type ImpersonationBannerInfo = {
  staffName: string;
  subjectName: string;
  /** Nullable: `users.email` is optional server-side, so the banner must
   *  render without it rather than printing "null" or "undefined". */
  subjectEmail: string | null;
  tenantId: string;
  tenantName: string;
  /** ISO 8601 — the client-side countdown computes its own remaining time from this, not a server-computed "seconds left" that goes stale the instant it's rendered. */
  expiresAt: string;
};

function toBannerInfo(payload: ImpersonationCookiePayload): ImpersonationBannerInfo {
  return {
    staffName: payload.staffName,
    subjectName: payload.subjectName,
    subjectEmail: payload.subjectEmail,
    tenantId: payload.tenantId,
    tenantName: payload.tenantName,
    expiresAt: payload.expiresAt,
  };
}

/** Null for the overwhelming common case: an ordinary person looking at their own account. */
export async function getPanelImpersonation(): Promise<ImpersonationBannerInfo | null> {
  const payload = await getImpersonation();
  return payload ? toBannerInfo(payload) : null;
}

/**
 * Finds the EXACT workspace an impersonation session is pinned to.
 *
 * Deliberately ignores `kind`, unlike `resolveActiveWorkspace` — that
 * function's fallback (first workspace of the requested kind, when the
 * cookie's choice doesn't match) is right for an ordinary person switching
 * panels, and exactly wrong here: it would silently swap in the SUBJECT's
 * *other* workspace the moment a panel of the wrong kind renders, which is a
 * bigger tenant than the one the session was actually opened and audited
 * for. `null` here means "this panel is the wrong kind for this session" and
 * the caller should send the person to the right one, not guess.
 */
export function resolveImpersonatedWorkspace(
  workspaces: WorkspaceSummary[],
  tenantId: string,
): WorkspaceSummary | null {
  return workspaces.find((w) => w.id === tenantId) ?? null;
}

/** Where a panel path lands for a given workspace kind — for the redirect above. */
export function panelRootFor(kind: 'business' | 'personal'): string {
  return kind === 'business' ? '/app/business' : '/app';
}

export function isImpersonationEndedError(error: unknown): error is ImpersonationEndedError {
  return error instanceof ImpersonationEndedError;
}
