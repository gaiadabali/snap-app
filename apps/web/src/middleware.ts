import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/api/server';

/**
 * Route guard for `/app/*` and `/admin/*` — the two surfaces docs/WEB.md §1
 * restricts to a signed-in person. Everything else (marketing, support,
 * download, `/sign-in`, `/register`, `/auth/*`) is untouched by the
 * `matcher` below, so this file cannot accidentally gate a page another
 * owner is building.
 *
 * This proves AUTHENTICATION only — that a session cookie is present. It
 * does not and cannot prove platform-staff AUTHORISATION for `/admin/*`:
 * docs/WEB.md §6 is explicit that the admin plane needs its own identity
 * table, its own database role, and a `SECURITY DEFINER` boundary before
 * cross-tenant access is real, and none of that exists yet (ownership row
 * #5). Until it does, this middleware is a necessary but not sufficient
 * gate for `/admin/*` — every admin route must still check platform-staff
 * status server-side once that plane exists, the same way `MembershipGuard`
 * is a fast rejection and `withTenantAs` is the actual boundary on the API.
 *
 * A cookie's mere presence is also not proof it is still valid — an expired
 * user, a revoked session — but a forged or stale token fails the same way
 * at the API on the next request either way (`SessionGuard` there is the
 * real check); this only saves a signed-out visitor a wasted round trip to a
 * page that would 401 anyway, and gives them a proper sign-in screen instead
 * of a raw API error.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL('/sign-in', request.url);
  // `pathname + search`, never the full URL — the return path this app
  // hands back to itself is always same-origin by construction, and
  // `safeReturnPath` (checked again wherever it is actually used to
  // redirect) does not need to defend against this app's own middleware,
  // only against a value that arrived from outside it.
  signInUrl.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ['/app/:path*', '/admin/:path*'],
};
