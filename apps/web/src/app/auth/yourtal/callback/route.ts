import { NextRequest, NextResponse } from 'next/server';
import type { AuthUser } from '@snap/api-contract';

import { ApiError, SESSION_COOKIE, api } from '@/lib/api/server';
import { AUTH_COOKIE_OPTIONS } from '@/lib/auth/session';
import { destinationAfterYourtalSignIn } from '@/lib/auth/yourtal-destination';
import {
  YOURTAL_GENERIC_ERROR,
  YOURTAL_LINK_INVALID_ERROR,
  yourtalErrorMessage,
} from '@/lib/auth/yourtal-errors';
import { YOURTAL_FLOW_COOKIE, YOURTAL_FLOW_COOKIE_PATH } from '@/lib/auth/yourtal-flow';

type WorkspaceSummary = { id: string; name: string; kind: string; role: string };
type FinishResult = {
  token: string;
  user: AuthUser;
  workspaces: WorkspaceSummary[];
  returnTo: string | null;
  outcome: 'signed_in' | 'linked' | 'created';
};

/**
 * The YourTal callback.
 *
 * YourTal redirects here with `code`, `state` and `iss` — or with `error` and
 * `error_description`. This route does not interpret any of them: the API
 * holds the PKCE verifier and nonce for the flow, checks `state` and `iss`,
 * exchanges the code and decides what the sign-in means. Here we only hand
 * them over together with the flow id from the cookie set at `/auth/yourtal`.
 *
 * The flow cookie is deleted on every exit path, success or failure: it is
 * single-use by construction. Nothing in the query string, the cookie or the
 * result is ever logged.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const flowId = request.cookies.get(YOURTAL_FLOW_COOKIE)?.value;

  const providerError = params.get('error');
  if (providerError) {
    return failure(request, yourtalErrorMessage(providerError, params.get('error_description')));
  }

  const code = params.get('code');
  const state = params.get('state');
  const iss = params.get('iss');
  if (!flowId || !code || !state || !iss) {
    return failure(request, YOURTAL_LINK_INVALID_ERROR);
  }

  let result: FinishResult;
  try {
    result = await api<FinishResult>('/v1/auth/yourtal/finish', {
      method: 'POST',
      body: { flowId, code, state, iss },
      anonymous: true,
    });
  } catch (error) {
    const message =
      error instanceof ApiError && error.message ? error.message : YOURTAL_GENERIC_ERROR;
    return failure(request, message);
  }

  const destination = destinationAfterYourtalSignIn(result.workspaces, result.returnTo);
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SESSION_COOKIE, result.token, AUTH_COOKIE_OPTIONS);
  clearFlowCookie(response);
  return response;
}

function failure(request: NextRequest, message: string): NextResponse {
  // The stored returnTo is owned by the API and not known on a failure, so the
  // person retries from the plain sign-in page.
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('error', message);
  const response = NextResponse.redirect(url);
  clearFlowCookie(response);
  return response;
}

/** The cookie was set with a narrowed path, so it can only be deleted with the same path. */
function clearFlowCookie(response: NextResponse): void {
  response.cookies.delete({ name: YOURTAL_FLOW_COOKIE, path: YOURTAL_FLOW_COOKIE_PATH });
}
