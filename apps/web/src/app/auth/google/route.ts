import { NextRequest, NextResponse } from 'next/server';

import { buildGoogleAuthorizeUrl } from '@/lib/auth/google';
import {
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_COOKIE_NAME,
  packOAuthState,
} from '@/lib/auth/oauth-state';
import { codeChallengeFromVerifier, generateCodeVerifier, generateNonce, generateState } from '@/lib/auth/pkce';
import { safeReturnPath } from '@/lib/auth/safe-redirect';

/**
 * Starts the Google OAuth 2.0 + PKCE flow.
 *
 * `?returnTo=` is validated here, not just where it is finally used — an
 * attacker-controlled value only ever needs to survive validation ONCE to be
 * dangerous, so it is checked at the point it enters the system and carried
 * as already-safe from then on.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get('returnTo'), '/app');

  let authorizeUrl: string;
  let state: string;
  let codeVerifier: string;
  let nonce: string;
  try {
    state = generateState();
    codeVerifier = generateCodeVerifier();
    nonce = generateNonce();
    authorizeUrl = buildGoogleAuthorizeUrl({
      state,
      nonce,
      codeChallenge: codeChallengeFromVerifier(codeVerifier),
    });
  } catch {
    // `googleOauth()` throws when GOOGLE_CLIENT_ID/SECRET are not set —
    // expected in every environment before staging credentials exist. A
    // clean redirect back to sign-in beats an unhandled 500.
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('error', 'Google sign-in is not configured yet.');
    url.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(
    OAUTH_COOKIE_NAME,
    packOAuthState({ state, codeVerifier, nonce, returnTo }),
    {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
    },
  );
  return response;
}
