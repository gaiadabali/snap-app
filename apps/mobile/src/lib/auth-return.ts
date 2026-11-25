import { isYourtalReturn } from './yourtal-signin';

/**
 * The browser build's end of Sign in with YourTal (the PWA, snapapp.app.gaiada.com).
 *
 * In a browser, `openAuthSessionAsync` opens YourTal in a popup and waits for that popup
 * to post the return URL back. YourTal returns the popup to this app's own page,
 * `/oauth/yourtal` (the server's YOURTAL_OIDC_MOBILE_WEB_REDIRECT_URI), where
 * `maybeCompleteAuthSession` does the posting: it checks that a sign-in is waiting in
 * this browser and that this page is the redirect it expects, then sends the URL to
 * the opener (same origin only). The opener finishes the sign-in as on a phone.
 *
 * It runs when the bundle loads, before the session gate, because the popup is
 * signed out and would otherwise show the sign-in screen instead of any route.
 * Nothing here reads or logs the query (`code`, `state`).
 */
export type AuthReturnOutcome = 'handed-back' | 'nothing-waiting';

/**
 * Null when this page is not the return page; otherwise whether the URL went back to
 * the tab that opened YourTal. `complete` is `WebBrowser.maybeCompleteAuthSession`.
 */
export function handBackAuthReturn(page: {
  pathname: string;
  complete: () => { type: string };
}): AuthReturnOutcome | null {
  if (!isYourtalReturn(page.pathname)) return null;
  try {
    return page.complete().type === 'success' ? 'handed-back' : 'nothing-waiting';
  } catch {
    // No opener (the opening tab was reloaded or closed): nothing to hand back to.
    return 'nothing-waiting';
  }
}

export const AUTH_RETURN_COPY = {
  handedBackTitle: 'Signing you in…',
  handedBackBody: 'This window closes by itself. If it stays open, close it and go back to SnapApp.',
  nothingTitle: 'This sign-in has finished',
  nothingBody: 'Go back to the SnapApp tab you started from, or open SnapApp here and sign in again.',
  open: 'Open SnapApp',
} as const;
