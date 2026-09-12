import { NextRequest, NextResponse } from 'next/server';
import type { AuthUser } from '@snap/api-contract';

import { ApiError, SESSION_COOKIE, api } from '@/lib/api/server';
import { exchangeGoogleCode } from '@/lib/auth/google';
import { OAUTH_COOKIE_NAME, unpackOAuthState, verifyState } from '@/lib/auth/oauth-state';
import { safeReturnPath } from '@/lib/auth/safe-redirect';
import { AUTH_COOKIE_OPTIONS } from '@/lib/auth/session';

type WorkspaceSummary = { id: string; name: string; kind: string; role: string };
type SignInResult = { token: string; user: AuthUser; workspaces: WorkspaceSummary[] };

/**
 * The Google OAuth callback.
 *
 * Order matters and is deliberate:
 *
 *  1. `state` is checked against the cookie set at `/auth/google` — CSRF.
 *     A mismatch (or a missing cookie: expired, cleared, never set) is
 *     refused with the SAME message as every other failure here, because a
 *     forged callback and an expired one should not be distinguishable to
 *     whoever is looking at the response.
 *  2. The code is exchanged for tokens using the PKCE verifier from that
 *     same cookie — a stolen `code` without the verifier is useless.
 *  3. The raw ID token is sent to the SERVER for independent verification.
 *     This app does not verify it itself and does not trust its own claims
 *     about what it contains — see `google-verify.ts`'s comment for why.
 *
 * The OAuth cookie is deleted on every exit path, success or failure: it is
 * single-use by construction.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const receivedState = params.get('state');
  const providerError = params.get('error');

  const saved = unpackOAuthState(request.cookies.get(OAUTH_COOKIE_NAME)?.value);
  const returnTo = safeReturnPath(saved?.returnTo, '/app');

  if (providerError) {
    return failure(request, 'Google sign-in was cancelled.', returnTo);
  }
  if (!code || !verifyState(saved, receivedState)) {
    return failure(request, 'That sign-in link is no longer valid. Please try again.', returnTo);
  }

  let idToken: string;
  try {
    idToken = await exchangeGoogleCode({ code, codeVerifier: saved!.codeVerifier });
  } catch {
    return failure(request, 'Could not complete Google sign-in.', returnTo);
  }

  let result: SignInResult;
  try {
    result = await api<SignInResult>('/v1/auth/oauth/google', {
      method: 'POST',
      body: { idToken, nonce: saved!.nonce },
      anonymous: true,
    });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Could not complete Google sign-in.';
    return failure(request, message, returnTo);
  }

  const destination = result.workspaces.length === 0 ? '/onboarding' : returnTo;
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SESSION_COOKIE, result.token, AUTH_COOKIE_OPTIONS);
  response.cookies.delete(OAUTH_COOKIE_NAME);
  return response;
}

function failure(request: NextRequest, message: string, returnTo: string): NextResponse {
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('error', message);
  url.searchParams.set('returnTo', returnTo);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_COOKIE_NAME);
  return response;
}
