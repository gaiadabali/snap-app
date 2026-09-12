import 'server-only';

import { cookies } from 'next/headers';

/**
 * The one place that knows how an active impersonation session is carried
 * between requests.
 *
 * The real admin plane (`POST /v1/admin/impersonation/start`) mints a
 * short-lived, revocable bearer token — the actual credential — and returns
 * it exactly once. There is no `GET` to look a session back up by id, so
 * unlike the fixture this replaced, this cookie IS the record: the token plus
 * everything the banner needs to render (who, which tenant, when it expires)
 * is stored together, JSON-encoded, in one httpOnly cookie.
 *
 * httpOnly is the whole point: the token is a credential (docs/WEB.md §6
 * point 3 / §3.1) and must never be readable by browser JavaScript. Storing
 * the display fields in the SAME httpOnly cookie is not a compromise of
 * that — nothing here is more sensitive than what the banner already prints
 * on the page — it just avoids a second cookie and a second parse.
 */
export const IMPERSONATION_COOKIE = 'snap_admin_impersonation';

export type ActiveImpersonation = {
  sessionId: string;
  /** The bearer credential for `X-Impersonation-Token`. Never read by client JS. */
  token: string;
  staffId: string;
  subjectUserId: string;
  subjectTenantId: string;
  /** Display name if the search result had one, else the email, else the id. */
  subjectLabel: string;
  subjectEmail: string | null;
  tenantName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
};

export async function setActiveImpersonation(session: ActiveImpersonation): Promise<void> {
  const jar = await cookies();
  jar.set(IMPERSONATION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    expires: new Date(session.expiresAt),
  });
}

export async function clearActiveImpersonation(): Promise<void> {
  const jar = await cookies();
  jar.delete(IMPERSONATION_COOKIE);
}

/**
 * The active session, or null once it has expired.
 *
 * This only reads the cookie — it cannot ask the server "is this still
 * valid?" (no such route exists; `admin_impersonation_verify` takes a token
 * hash, not a session id, and is reached only via the tenant-documents route).
 * A staff member's own actions against real tenant data are re-checked by the
 * database on every call regardless of what this cookie says, so a stale
 * client-side read here is a display nuisance, not a security gap.
 */
export async function getActiveImpersonationSession(): Promise<ActiveImpersonation | null> {
  const jar = await cookies();
  const raw = jar.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;
  let parsed: ActiveImpersonation;
  try {
    parsed = JSON.parse(raw) as ActiveImpersonation;
  } catch {
    return null;
  }
  if (Date.parse(parsed.expiresAt) <= Date.now()) return null;
  return parsed;
}
