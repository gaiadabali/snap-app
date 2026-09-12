import 'server-only';

import { cookies } from 'next/headers';

import { SESSION_COOKIE, WORKSPACE_COOKIE } from '@/lib/api/server';

/**
 * The session cookie, set exactly once, here.
 *
 * docs/WEB.md §3.1: the token must never reach browser JavaScript. httpOnly
 * makes that true; Secure means it is only ever sent to this app over a
 * connection a network attacker cannot read (Chromium treats `127.0.0.1` and
 * `localhost` as a secure context too, so this holds in local dev without
 * weakening it in production); SameSite=Lax means it is not attached to a
 * cross-site POST, which is the CSRF-relevant case for a cookie that
 * authenticates a write.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
};

/** For a Server Action or Server Component — Route Handlers should set cookies on their `NextResponse` directly using `AUTH_COOKIE_OPTIONS`. */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, AUTH_COOKIE_OPTIONS);
}

export async function setActiveWorkspaceCookie(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, AUTH_COOKIE_OPTIONS);
}

/** Sign-out clears BOTH cookies — leaving the workspace cookie behind is its own small leak of which workspace someone was last in. */
export async function clearAuthCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(WORKSPACE_COOKIE);
}

export async function hasSessionCookie(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(SESSION_COOKIE)?.value);
}
