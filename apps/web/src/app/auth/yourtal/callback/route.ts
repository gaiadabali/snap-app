import { publicUrl } from '@/lib/http/public-url';
import { NextRequest, NextResponse } from 'next/server';
import type { AuthUser, FtrSendFinished } from '@snap/api-contract';

import { ApiError, SESSION_COOKIE, api } from '@/lib/api/server';
import { type AuthErrorCode, apiErrorCode } from '@/lib/auth/auth-errors';
import { AUTH_COOKIE_OPTIONS } from '@/lib/auth/session';
import { destinationAfterYourtalSignIn } from '@/lib/auth/yourtal-destination';
import { yourtalErrorCode } from '@/lib/auth/yourtal-errors';
import { safeReturnPath } from '@/lib/auth/safe-redirect';
import { FTR_SEND_COOKIE, YOURTAL_FLOW_COOKIE, YOURTAL_FLOW_COOKIE_PATH } from '@/lib/auth/yourtal-flow';
import { loadWorkspace } from '@/lib/panels/workspace';
import { YOURTAL_MOVE_MISMATCH, YOURTAL_MOVE_PARAM } from '@/lib/yourtal-move';

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

  // A send to Free Tax Returns (group 4.8.a) comes back here too; its marker cookie says so.
  if (flowId && request.cookies.get(FTR_SEND_COOKIE)?.value === '1') return finishSend(request, flowId);

  const providerError = params.get('error');
  if (providerError) {
    return failure(yourtalErrorCode(providerError, params.get('error_description')));
  }

  const code = params.get('code');
  const state = params.get('state');
  const iss = params.get('iss');
  if (!flowId || !code || !state || !iss) {
    return failure('link_invalid');
  }

  let result: FinishResult;
  try {
    result = await api<FinishResult>('/v1/auth/yourtal/finish', {
      method: 'POST',
      body: { flowId, code, state, iss },
      anonymous: true,
    });
  } catch (error) {
    const code = apiErrorCode(error, 'yourtal_failed');
    if (code === 'yourtal_email_mismatch') return moveMismatch();
    return failure(code);
  }

  const destination = destinationAfterYourtalSignIn(result.workspaces, result.returnTo);
  const response = NextResponse.redirect(publicUrl(destination));
  response.cookies.set(SESSION_COOKIE, result.token, AUTH_COOKIE_OPTIONS);
  clearFlowCookie(response);
  return response;
}

/** A move (3.6.e) with another YourTal email: back to the signed-in page, whose prompt explains. */
function moveMismatch(): NextResponse {
  const url = publicUrl('/app');
  url.searchParams.set(YOURTAL_MOVE_PARAM, YOURTAL_MOVE_MISMATCH);
  const response = NextResponse.redirect(url);
  clearFlowCookie(response);
  return response;
}

function failure(code: AuthErrorCode): NextResponse {
  // The stored returnTo is owned by the API and not known on a failure, so the
  // person retries from the plain sign-in page.
  const url = publicUrl('/sign-in');
  url.searchParams.set('error', code);
  const response = NextResponse.redirect(url);
  clearFlowCookie(response);
  return response;
}

/** The cookie was set with a narrowed path, so it can only be deleted with the same path. */
function clearFlowCookie(response: NextResponse): void {
  response.cookies.delete({ name: YOURTAL_FLOW_COOKIE, path: YOURTAL_FLOW_COOKIE_PATH });
  response.cookies.delete({ name: FTR_SEND_COOKIE, path: YOURTAL_FLOW_COOKIE_PATH });
}

/**
 * Finishes a send: the signed-in person's own session and personal workspace,
 * the flow id from the cookie, and what YourTal returned (a code, or `error`
 * when they pressed Cancel). Answers with a redirect back to the categories
 * page whose `?ftr=` says what happened (a code, never text).
 */
async function finishSend(request: NextRequest, flowId: string): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const back = (query: Record<string, string>, returnTo?: string | null): NextResponse => {
    const url = publicUrl(safeReturnPath(returnTo, '/app/categories'));
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const response = NextResponse.redirect(url);
    clearFlowCookie(response);
    return response;
  };

  const state = params.get('state');
  const error = params.get('error');
  const code = params.get('code');
  const iss = params.get('iss');
  if (!state || (!error && (!code || !iss))) return back({ ftr: 'failed', code: 'invalid_flow' });

  // Outside the try: no session redirects to sign-in, which throws.
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return back({ ftr: 'failed', code: 'not_personal' });
  try {
    const result = await api<FtrSendFinished>('/v1/ftr-sends/finish', {
      method: 'POST',
      body: { flowId, state, ...(error ? { error } : { code, iss }) },
      workspaceId: workspace.id,
    });
    return result.status === 'sent'
      ? back({ ftr: 'sent', fy: result.financialYear }, result.returnTo)
      : back({ ftr: 'cancelled' }, result.returnTo);
  } catch (e) {
    const body = e instanceof ApiError ? (e.body as { error?: unknown } | undefined) : undefined;
    // Cancel at YourTal's send screen comes back as `send_refused`: the same as cancelled.
    if (body?.error === 'send_refused') return back({ ftr: 'cancelled' });
    return back({ ftr: 'failed', code: typeof body?.error === 'string' ? body.error : 'failed' });
  }
}
