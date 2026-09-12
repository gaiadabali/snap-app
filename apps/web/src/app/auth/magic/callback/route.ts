import { NextRequest, NextResponse } from 'next/server';
import type { AuthUser } from '@snap/api-contract';

import { ApiError, SESSION_COOKIE, api } from '@/lib/api/server';
import { safeReturnPath } from '@/lib/auth/safe-redirect';
import { AUTH_COOKIE_OPTIONS } from '@/lib/auth/session';

type WorkspaceSummary = { id: string; name: string; kind: string; role: string };
type SignInResult = { token: string; user: AuthUser; workspaces: WorkspaceSummary[] };

/**
 * The magic-link callback. All the security-relevant work — signature,
 * expiry, and single-use enforcement — happens server-side at
 * `POST /v1/auth/magic-link/consume`; this route only forwards the token and
 * turns the result into a cookie. A tampered, expired, or already-redeemed
 * token all fail the SAME way from here, because the server endpoint answers
 * them the same way on purpose.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get('returnTo'), '/app');

  if (!token) return failure(request, 'That link is missing its token.', returnTo);

  let result: SignInResult;
  try {
    result = await api<SignInResult>('/v1/auth/magic-link/consume', {
      method: 'POST',
      body: { token },
      anonymous: true,
    });
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : 'That link is invalid or has expired.';
    return failure(request, message, returnTo);
  }

  const destination = result.workspaces.length === 0 ? '/onboarding' : returnTo;
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SESSION_COOKIE, result.token, AUTH_COOKIE_OPTIONS);
  return response;
}

function failure(request: NextRequest, message: string, returnTo: string): NextResponse {
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('error', message);
  url.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(url);
}
