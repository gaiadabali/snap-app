import 'server-only';

/**
 * The transient cookie that carries one Google sign-in attempt from the
 * redirect to the callback.
 *
 * Not the session cookie — it never authenticates anyone. It exists purely so
 * the callback can check the `state` Google echoes back against the value
 * this app itself generated (CSRF), recover the PKCE `code_verifier` (which
 * never appears in a URL, so it cannot leak via a referrer header or browser
 * history), and re-apply the `nonce` the ID token must contain. httpOnly +
 * Secure + SameSite=Lax + a ten-minute expiry, matching every other cookie
 * this app sets, and always deleted after the callback runs once — success
 * or failure — so it is never valid for a second attempt.
 */
export type OAuthState = {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
};

export const OAUTH_COOKIE_NAME = 'snap_oauth';
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

export function packOAuthState(value: OAuthState): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function unpackOAuthState(raw: string | undefined | null): OAuthState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as OAuthState).state !== 'string' ||
      typeof (parsed as OAuthState).codeVerifier !== 'string' ||
      typeof (parsed as OAuthState).nonce !== 'string' ||
      typeof (parsed as OAuthState).returnTo !== 'string'
    ) {
      return null;
    }
    return parsed as OAuthState;
  } catch {
    return null;
  }
}

/**
 * True only if a saved attempt exists and its `state` matches what the
 * callback received. Both are absent, missing, or mismatched are refused the
 * same way — the caller does not get to learn which.
 */
export function verifyState(saved: OAuthState | null, receivedState: string | null): boolean {
  if (!saved || !receivedState) return false;
  return saved.state === receivedState;
}
