import { publicUrl } from '@/lib/http/public-url';
import { NextRequest, NextResponse } from 'next/server';

import { api } from '@/lib/api/server';
import { apiErrorCode } from '@/lib/auth/auth-errors';
import { safeReturnPath } from '@/lib/auth/safe-redirect';
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
  // "Sign in again" after staff_reauth_required: YourTal must ask for a new sign-in (prompt=login).
  const freshSignIn = params.get('fresh') === '1';
  // A parent's join link (`/auth/yourtal?teenInvite=<code>`): the API checks
  // the code's shape and hands it to YourTal, which checks the guardian.
  const teenInvite = params.get('teenInvite') ?? undefined;
  // The "keep your account" prompt (3.6.e): the API ties the flow to THIS session's account.
  const move = params.get('move') === '1';

  let result: StartResult;
  try {
    result = await api<StartResult>('/v1/auth/yourtal/start', {
      method: 'POST',
      body: {
        client: 'web',
        returnTo,
        signUp,
        ...(freshSignIn ? { freshSignIn } : {}),
        ...(teenInvite ? { teenInvite } : {}),
        ...(move ? { moveCurrentAccount: true } : {}),
        locale: 'en-AU',
      },
      // Ordinary sign-ins send no session; a move must send it.
      anonymous: !move,
      bypassImpersonation: move,
    });
  } catch (error) {
    // A code, never text: the page words it (see `auth-errors.ts`).
    const code = apiErrorCode(error, 'yourtal_unavailable');
    const url = publicUrl(signUp ? '/register' : '/sign-in');
    url.searchParams.set('error', code);
    url.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(result.url);
  response.cookies.set(YOURTAL_FLOW_COOKIE, result.flowId, YOURTAL_FLOW_COOKIE_OPTIONS);
  return response;
}
