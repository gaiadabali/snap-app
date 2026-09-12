import 'server-only';

import { googleOauth } from '@/lib/config';

/**
 * The two calls to Google itself. Verification of what comes back does NOT
 * happen here — see `apps/server/src/auth/google-verify.ts` for why the
 * server, not this app, is where the ID token is independently re-checked.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function buildGoogleAuthorizeUrl(params: {
  state: string;
  codeChallenge: string;
  nonce: string;
}): string {
  const { clientId, redirectUri } = googleOauth();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('nonce', params.nonce);
  // Always show the account chooser instead of silently reusing whichever
  // Google session happens to be active in this browser — on a shared or
  // work computer, silently signing in as "whoever is logged into Chrome" is
  // the wrong kind of convenient for a finance app.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

type GoogleTokenResponse = {
  id_token?: string;
  error?: string;
  error_description?: string;
};

/**
 * Exchanges an authorization code for tokens and returns the raw,
 * UNVERIFIED `id_token`. This app holds the OAuth client secret
 * (`googleOauth()`), so it is the one that can do this exchange — but
 * holding the secret only proves the code came from a real token endpoint
 * response, not that the ID token inside it is trustworthy on its own terms.
 * That is a separate question, answered independently by the server.
 */
export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
}): Promise<string> {
  const { clientId, clientSecret, redirectUri } = googleOauth();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const parsed = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok || !parsed.id_token) {
    throw new Error(parsed.error_description ?? parsed.error ?? 'Google sign-in failed.');
  }
  return parsed.id_token;
}
