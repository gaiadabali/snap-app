import 'server-only';

import { cookies } from 'next/headers';

import { getActiveSession, type ImpersonationSession } from '../_data/impersonation';

/**
 * The one place that knows how an active impersonation session is carried
 * between requests: an httpOnly cookie holding the session id, looked up
 * against the fixture store in `_data/impersonation.ts`.
 *
 * A real implementation swaps the cookie's payload for a signed, revocable
 * token (docs/WEB.md §6 point 3) and the lookup for a verified decode — the
 * shape callers see (`ImpersonationSession | null`) does not change.
 */
export const IMPERSONATION_COOKIE = 'snap_admin_impersonation';

export async function getActiveImpersonationSession(): Promise<ImpersonationSession | null> {
  const jar = await cookies();
  const sessionId = jar.get(IMPERSONATION_COOKIE)?.value;
  if (!sessionId) return null;
  return getActiveSession(sessionId);
}
