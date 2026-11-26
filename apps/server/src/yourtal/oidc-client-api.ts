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
 * The shared request: one call with the bearer token for `scope`; a 401 drops
 * that token and tries once more. Null when YourTal is unreachable or no token
 * could be had.
 */
async function request(
  scope: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
  idempotencyKey?: string,
): Promise<Response | null> {
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
      // Not read: the connection is released when the body is dropped.
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    return response;
  }
  return null;
}

/**
 * One call with the bearer token for `scope`; a 401 drops that token and tries
 * once more. Null when YourTal is unreachable. Callers treat a missing token
 * (also null) as unavailable.
 */
export async function oidcApiCall(
  scope: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
  idempotencyKey?: string,
): Promise<Answer> {
  const response = await request(scope, method, path, body, idempotencyKey);
  if (!response) return null;
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { status: response.status, body: record };
}

export type BytesAnswer = { status: number; bytes: Buffer; contentType: string | null } | null;

/** The most a binary answer may be: a mailed statement is at most 10 MB (spambank/BUILD.md §4.8). */
export const OIDC_BYTES_MAX = 12 * 1024 * 1024;

/**
 * Like `oidcApiCall`, for an answer that is a file (YourTal's
 * `/api/oidc-clients/spambank/attachments/fetch`): the raw bytes and their
 * `Content-Type`. Null when YourTal is unreachable, and also when the answer is
 * larger than `maxBytes`, which is read no further than the limit. An error
 * answer (a 404 with a small JSON body) comes back as bytes too: look at
 * `status` first.
 */
export async function oidcApiBytes(
  scope: string,
  method: 'GET' | 'POST',
  path: string,
  body?: object,
  options: { maxBytes?: number; idempotencyKey?: string } = {},
): Promise<BytesAnswer> {
  const maxBytes = options.maxBytes ?? OIDC_BYTES_MAX;
  const response = await request(scope, method, path, body, options.idempotencyKey);
  if (!response) return null;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
    }
    return {
      status: response.status,
      bytes: Buffer.concat(chunks, total),
      contentType: response.headers.get('content-type'),
    };
  } catch {
    return null;
  }
}
