import { isYourtalReturn } from '@/lib/yourtal-signin';

/**
 * Keeps the Sign in with YourTal redirect (`au.com.snapapps.app:/oauth/yourtal`)
 * from being treated as a screen.
 *
 * `openAuthSessionAsync` hands that URL to the sign-in code that is waiting for
 * it, but Android also delivers it to the app as an ordinary deep link. Without
 * this, the router would look for a route called `oauth/yourtal`, find none,
 * and show "not found" over the app. It is sent home instead, and its query
 * (`code`, `state`) is dropped here, not passed on to anything.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return isYourtalReturn(path) ? '/' : path;
}
