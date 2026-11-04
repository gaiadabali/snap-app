import * as oidc from 'openid-client';

import { config, yourtalApiUrl, yourtalEventsClientId } from '../config.js';
import { webClientKey } from '../auth/yourtal-signin/settings.js';

/**
 * SnapApp's SERVER client at YourTal (`snapapp-staging-server`,
 * YOURTAL_OIDC_SERVER_CLIENT_ID): a client-credentials token per scope,
 * authenticating with `private_key_jwt` and the website client's key
 * (YOURTAL_OIDC_KEY_FILE), so YourTal registers that one public key for both.
 * Moved here from teens/invite-api.ts when 4.8.a added the `app_transfers`
 * scope: one cached token per scope (10 minutes, reused until a minute
 * before it ends), one call helper with one 401 retry.
 *
 * Never logs a token or a response body.
 */

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** On when the issuer, the server client id and the key file are all set. */
export function oidcClientConfigured(): boolean {
  const settings = config();
  return Boolean(settings.YOURTAL_OIDC_ISSUER && settings.YOURTAL_OIDC_KEY_FILE && yourtalEventsClientId());
}

let discovered: { key: string; at: number; config: Promise<oidc.Configuration> } | null = null;
const tokens = new Map<string, { key: string; value: string; expiresAt: number }>();

/** Tests only. */
export function resetOidcClientApiCache(): void {
  discovered = null;
  tokens.clear();
}

function configuration(): Promise<oidc.Configuration> {
  const issuer = config().YOURTAL_OIDC_ISSUER!;
  const clientId = yourtalEventsClientId()!;
  const key = `${issuer} ${clientId}`;
  if (discovered && discovered.key === key && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.config;
  const made = (async () => {
    const { key: signingKey, kid } = await webClientKey();
    const url = new URL(issuer);
    return oidc.discovery(url, clientId, {}, oidc.PrivateKeyJwt({ key: signingKey, kid }), {
      timeout: TIMEOUT_MS / 1000,
      // Plain http only outside production (config.ts refuses it there).
      execute: url.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
    });
  })();
  discovered = { key, at: Date.now(), config: made };
  made.catch(() => {
    if (discovered?.config === made) discovered = null;
  });
  return made;
}

async function accessToken(scope: string): Promise<string> {
  const key = `${config().YOURTAL_OIDC_ISSUER} ${yourtalEventsClientId()}`;
  const cached = tokens.get(scope);
  if (cached && cached.key === key && Date.now() < cached.expiresAt - 60_000) return cached.value;
  const response = await oidc.clientCredentialsGrant(await configuration(), { scope });
  const lifetime = (response.expires_in ?? 600) * 1000;
  tokens.set(scope, { key, value: response.access_token, expiresAt: Date.now() + lifetime });
  return response.access_token;
}

export type Answer = { status: number; body: Record<string, unknown> } | null;

/**
 * One call with the bearer token for `scope`; a 401 drops that token and tries
 * once more. Null when YourTal is unreachable. May throw when no token can be
 * had: callers treat a throw as unavailable.
 */
export async function oidcApiCall(
  scope: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
  idempotencyKey?: string,
): Promise<Answer> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${yourtalApiUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await accessToken(scope)}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (response.status === 401 && attempt === 0) {
      tokens.delete(scope);
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    return { status: response.status, body: record };
  }
  return null;
}
