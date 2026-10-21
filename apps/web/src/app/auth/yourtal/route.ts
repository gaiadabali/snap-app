import { publicUrl } from '@/lib/http/public-url';
import { NextRequest, NextResponse } from 'next/server';

import { ApiError, api } from '@/lib/api/server';
import { safeReturnPath } from '@/lib/auth/safe-redirect';
import { YOURTAL_UNAVAILABLE_ERROR } from '@/lib/auth/yourtal-errors';
import { YOURTAL_FLOW_COOKIE, YOURTAL_FLOW_COOKIE_OPTIONS } from '@/lib/auth/yourtal-flow';

type StartResult = { url: string; flowId: string; expiresAt: string };

/**
 * Starts "Sign in with YourTal".
 *
 * The API builds the authorization URL (PKCE, state and nonce live there, not
 * in this website); this route only asks for one and sends the browser to it.
 *
 * `?returnTo=` is validated here, at the point it enters the system, exactly
 * as the Google route does. The flow cookie's options (and why it is Lax) are
 * documented in `yourtal-flow.ts`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const returnTo = safeReturnPath(params.get('returnTo'), '/app');
  const signUp = params.get('signUp') === '1';

  let result: StartResult;
  try {
    result = await api<StartResult>('/v1/auth/yourtal/start', {
      method: 'POST',
      body: { client: 'web', returnTo, signUp, locale: 'en-AU' },
      anonymous: true,
    });
  } catch (error) {
    const message =
      error instanceof ApiError && error.message ? error.message : YOURTAL_UNAVAILABLE_ERROR;
    const url = publicUrl(signUp ? '/register' : '/sign-in');
    url.searchParams.set('error', message);
    url.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(result.url);
  response.cookies.set(YOURTAL_FLOW_COOKIE, result.flowId, YOURTAL_FLOW_COOKIE_OPTIONS);
  return response;
}
