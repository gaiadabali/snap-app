'use server';

import { redirect } from 'next/navigation';
import type { AuthUser } from '@snap/api-contract';

import { ApiError, api, newIdempotencyKey } from '@/lib/api/server';

import { isDevBypassAvailable } from './dev-bypass';
import { isGoogleSignInSimulatorAvailable } from './google-simulator';
import { safeReturnPath } from './safe-redirect';
import { setActiveWorkspaceCookie, setSessionCookie } from './session';

type WorkspaceSummary = { id: string; name: string; kind: string; role: string };
type SignInResult = { token: string; user: AuthUser; workspaces: WorkspaceSummary[] };

function destinationAfterSignIn(workspaces: WorkspaceSummary[], returnTo: string): string {
  // A brand-new account has nowhere to put a receipt yet — onboarding, not
  // whatever page they happened to land on sign-in from, is the only useful
  // next screen.
  return workspaces.length === 0 ? '/onboarding' : returnTo;
}

function signInFailureRedirect(message: string, returnTo: string, path = '/sign-in'): never {
  const url = new URL(path, 'http://placeholder');
  url.searchParams.set('error', message);
  url.searchParams.set('returnTo', returnTo);
  redirect(`${url.pathname}${url.search}`);
}

/**
 * Request a passwordless sign-in link.
 *
 * Always lands back on the same "check your email" state whether the address
 * has an account, the send succeeded, or the request was simply rate
 * limited — see the server endpoint's own comment: a different outcome for
 * "no such user" is exactly how this kind of form gets used to enumerate real
 * addresses.
 */
export async function requestMagicLinkAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const returnTo = safeReturnPath(String(formData.get('returnTo') ?? ''), '/app');

  if (!email) signInFailureRedirect('Enter your email address.', returnTo);

  try {
    await api('/v1/auth/magic-link/request', {
      method: 'POST',
      body: { email },
      anonymous: true,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch {
    // Swallowed on purpose — see the doc comment above.
  }

  const url = new URL('/sign-in', 'http://placeholder');
  url.searchParams.set('sent', '1');
  url.searchParams.set('returnTo', returnTo);
  redirect(`${url.pathname}${url.search}`);
}

/**
 * The development-only sign-in bypass: trades a bare email for a session with
 * no proof of ownership at all. `isDevBypassAvailable()` is checked here
 * again, not only by the page that renders the form — see that function's
 * own comment for why the check has to live on both sides.
 */
export async function devBypassSignInAction(formData: FormData): Promise<void> {
  if (!isDevBypassAvailable()) {
    throw new Error(
      'The development sign-in bypass is not available. It requires NODE_ENV to not be ' +
        '"production" AND SNAP_DEV_AUTH_BYPASS=true — both, not just this form having been shown.',
    );
  }

  const email = String(formData.get('email') ?? '').trim();
  const returnTo = safeReturnPath(String(formData.get('returnTo') ?? ''), '/app');
  if (!email) signInFailureRedirect('Enter an email address.', returnTo);

  let result: SignInResult;
  try {
    result = await api<SignInResult>('/v1/auth/sign-in', {
      method: 'POST',
      body: { email },
      anonymous: true,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Sign-in failed.';
    signInFailureRedirect(message, returnTo);
  }

  await setSessionCookie(result.token);
  redirect(destinationAfterSignIn(result.workspaces, returnTo));
}

/**
 * The simulated Google sign-in: mints a real session for one of a fixed,
 * server-side allow-listed demo identities — never an arbitrary address.
 * `isGoogleSignInSimulatorAvailable()` is checked here again, not only by the
 * page that lists the identities — the same "don't trust the client, re-check
 * server-side" rule `devBypassSignInAction` follows above. The server's own
 * `/v1/auth/google-simulator/sign-in` endpoint enforces the identical three
 * conditions again, completely independently, and separately re-validates
 * that the requested email is actually on the allow-list — this action is a
 * convenience, not the boundary.
 */
export async function googleSimulatorSignInAction(formData: FormData): Promise<void> {
  if (!isGoogleSignInSimulatorAvailable()) {
    throw new Error(
      'The Google sign-in simulator is not available. It requires NODE_ENV to not be ' +
        '"production" (or DEMO_ENV=staging), GOOGLE_SIGNIN_SIMULATOR=true, and no real Google ' +
        'credentials configured — all three, not just this form having been shown.',
    );
  }

  const email = String(formData.get('email') ?? '').trim();
  const returnTo = safeReturnPath(String(formData.get('returnTo') ?? ''), '/app');
  if (!email) signInFailureRedirect('Choose a demo identity.', returnTo, '/auth/google-simulator');

  let result: SignInResult;
  try {
    result = await api<SignInResult>('/v1/auth/google-simulator/sign-in', {
      method: 'POST',
      body: { email },
      anonymous: true,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    // The server answers an identical 404 whether the simulator is disabled
    // or the email is simply not on its allow-list — see that endpoint's own
    // comment. Either way, the honest message here is the same for the
    // person looking at this screen.
    const message =
      error instanceof ApiError && error.status === 404
        ? 'That is not one of the demo identities.'
        : error instanceof ApiError
          ? error.message
          : 'Simulated sign-in failed.';
    signInFailureRedirect(message, returnTo, '/auth/google-simulator');
  }

  await setSessionCookie(result.token);
  redirect(destinationAfterSignIn(result.workspaces, returnTo));
}

export type OnboardingFormResult = { workspaceId: string };

/**
 * The three questions a brand-new account has to answer before it can file
 * anything, in the exact shape `POST /v1/workspaces/onboarding` expects
 * (`apps/server/src/workspaces/workspaces.controller.ts#OnboardingDto`) — this
 * does not invent a parallel onboarding shape, it is a form over that one
 * endpoint.
 */
export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const kind = formData.get('kind') === 'business' ? 'business' : 'personal';
  const workspaceName = String(formData.get('workspaceName') ?? '').trim();

  if (!workspaceName) {
    redirect(`/onboarding?error=${encodeURIComponent('Give your workspace a name.')}&kind=${kind}`);
  }

  const body: Record<string, unknown> = { workspaceName, kind };
  if (kind === 'business') {
    const abn = String(formData.get('abn') ?? '').replace(/\D/g, '');
    if (abn) body.abn = abn;
    body.gstRegistered = formData.get('gstRegistered') === 'on';
    const gstBasis = formData.get('gstBasis');
    if (gstBasis === 'cash' || gstBasis === 'accrual') body.gstBasis = gstBasis;
  }
  if (kind === 'personal') {
    const monthlyBudget = String(formData.get('monthlyBudget') ?? '').trim();
    if (monthlyBudget) body.monthlyBudget = monthlyBudget;
  }
  const occupationProfileId = String(formData.get('occupationProfileId') ?? '').trim();
  if (occupationProfileId) body.occupationProfileId = occupationProfileId;

  let result: OnboardingFormResult;
  try {
    result = await api<OnboardingFormResult>('/v1/workspaces/onboarding', {
      method: 'POST',
      body,
      idempotencyKey: newIdempotencyKey(),
    });
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Something went wrong finishing setup.';
    redirect(`/onboarding?error=${encodeURIComponent(message)}&kind=${kind}`);
  }

  await setActiveWorkspaceCookie(result.workspaceId);
  redirect('/app');
}
