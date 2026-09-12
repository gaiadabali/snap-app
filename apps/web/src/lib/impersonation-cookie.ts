import 'server-only';

import { cookies } from 'next/headers';

/**
 * THE impersonation cookie. One definition, used by both sides.
 *
 * It exists here, in `lib/`, rather than under `app/admin/`, because it is the
 * seam between two surfaces that must agree exactly: the admin console WRITES
 * it when a support session starts, and the customer-facing panels READ it to
 * send `X-Impersonation-Token` and to render the banner.
 *
 * They did not agree. The console wrote `snap_admin_impersonation` at
 * `path: '/admin'` while the panels read `snap_impersonation` at `path: '/'`,
 * and the field names differed too — so a session started in the console sent
 * nothing at all on a request to `/app/*`. A cookie scoped to `/admin` is
 * simply never attached to a request for another path, which makes the failure
 * total and completely silent: no error, no banner, the staff member just sees
 * their own account and believes they are looking at the customer's.
 *
 * Two modules agreeing by convention is what produced that. One module is the
 * fix.
 *
 * **`path: '/'` is load-bearing.** Do not scope this to a subtree.
 *
 * **httpOnly is the point.** `token` is the credential the server accepts
 * (docs/WEB.md §3.1 / §6) and must never be readable by browser JavaScript.
 * The display fields live in the same cookie because none of them is more
 * sensitive than what the banner already prints on the page, and one cookie is
 * one parse and one expiry to keep in step.
 */

export const IMPERSONATION_COOKIE = 'snap_impersonation';

export type ImpersonationCookiePayload = {
  sessionId: string;
  /** The bearer credential for `X-Impersonation-Token`. Never reaches client JS. */
  token: string;

  /** Who is acting. */
  staffId: string;
  staffName: string;

  /** Who they are acting as. */
  subjectUserId: string;
  subjectName: string;
  subjectEmail: string | null;

  /**
   * The ONE workspace this session is pinned to.
   *
   * The server enforces the same pin (`MembershipGuard` refuses a mismatched
   * `X-Workspace-Id` with 403), so this is how the client stays on the right
   * side of that rather than discovering it as an error.
   */
  tenantId: string;
  tenantName: string;

  /** Audited server-side; carried here so the banner can show why. */
  reason: string;
  startedAt: string;
  /** ISO 8601. The banner computes its own countdown from this. */
  expiresAt: string;
};

export async function setImpersonation(session: ImpersonationCookiePayload): Promise<void> {
  const jar = await cookies();
  const expires = new Date(session.expiresAt);
  if (Number.isNaN(expires.getTime())) {
    // Refused rather than written as a session cookie that outlives the
    // server-side session: the browser would keep sending a token the server
    // has already stopped honouring, and the banner would keep claiming an
    // active session that is not.
    throw new Error(`Impersonation session has an unreadable expiry: ${session.expiresAt}`);
  }

  jar.set(IMPERSONATION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    // Set on HTTPS only in production; a Secure cookie is never stored over
    // plain http, which would break local development entirely.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function clearImpersonation(): Promise<void> {
  const jar = await cookies();
  // Deleted with the SAME path it was written with — a delete that does not
  // match leaves the original cookie in place and the session looks immortal.
  jar.set(IMPERSONATION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

/**
 * The active session, or null once it has expired or the cookie is unreadable.
 *
 * This only reads a cookie; it cannot ask the server whether the session is
 * still live. It does not need to. `admin_impersonation_verify` re-checks the
 * token on EVERY request, so a stale read here is a display nuisance that
 * the next API call corrects — never an authorisation gap.
 */
export async function getImpersonation(): Promise<ImpersonationCookiePayload | null> {
  const jar = await cookies();
  const raw = jar.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;

  let parsed: Partial<ImpersonationCookiePayload>;
  try {
    parsed = JSON.parse(raw) as Partial<ImpersonationCookiePayload>;
  } catch {
    return null;
  }

  // Every field the two sides depend on, checked once here. A half-written
  // cookie from an older shape must read as "no session" rather than crash a
  // layout on a missing property.
  if (
    !parsed.sessionId ||
    !parsed.token ||
    !parsed.subjectUserId ||
    !parsed.tenantId ||
    !parsed.expiresAt
  ) {
    return null;
  }
  // FAIL CLOSED on an unparseable expiry.
  //
  // `Date.parse` returns NaN for anything it cannot read, and every comparison
  // against NaN is false — so the obvious `if (Date.parse(x) <= Date.now())`
  // treats an unreadable timestamp as a session that NEVER expires. Checked
  // explicitly because the server currently returns Postgres' default
  // timestamp rendering ("2026-09-12 06:14:05.244391+00", a space rather than
  // a `T`) where the contract declares `IsoDateTime`. V8 happens to parse that
  // leniently, so this works today by luck rather than by contract.
  const expiresAt = Date.parse(parsed.expiresAt);
  if (Number.isNaN(expiresAt)) return null;
  if (expiresAt <= Date.now()) return null;

  return parsed as ImpersonationCookiePayload;
}
