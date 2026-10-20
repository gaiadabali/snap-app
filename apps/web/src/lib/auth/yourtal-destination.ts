import { safeReturnPath } from './safe-redirect';

/**
 * Where to send someone straight after "Sign in with YourTal" succeeds.
 *
 * A brand-new account has nowhere to put a receipt yet, so onboarding wins.
 * Otherwise it is the `returnTo` the API stored when the flow started —
 * validated AGAIN here, because it crossed a network boundary and a redirect
 * must never be the first place a path is trusted.
 */
export function destinationAfterYourtalSignIn(
  workspaces: ReadonlyArray<unknown>,
  returnTo: string | null | undefined,
): string {
  if (workspaces.length === 0) return '/onboarding';
  return safeReturnPath(returnTo, '/app');
}
