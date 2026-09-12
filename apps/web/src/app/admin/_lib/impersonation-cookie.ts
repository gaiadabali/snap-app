import 'server-only';

/**
 * The admin console's view of the impersonation cookie.
 *
 * This file used to OWN the cookie — its own name (`snap_admin_impersonation`),
 * its own `path: '/admin'`, and its own field names — while the customer
 * panels independently read a differently-named cookie at `path: '/'`. The
 * result was that starting a session here sent nothing whatsoever on a request
 * to `/app/*`: a cookie scoped to a subtree is never attached to a request for
 * another path, so the staff member saw their own account and had every reason
 * to believe it was the customer's.
 *
 * The definition now lives in `@/lib/impersonation-cookie`, shared by both
 * sides. This module is the console's names for it, kept so admin pages read
 * naturally — not a second implementation.
 */
export {
  IMPERSONATION_COOKIE,
  clearImpersonation as clearActiveImpersonation,
  getImpersonation as getActiveImpersonationSession,
  setImpersonation as setActiveImpersonation,
  type ImpersonationCookiePayload as ActiveImpersonation,
} from '@/lib/impersonation-cookie';
