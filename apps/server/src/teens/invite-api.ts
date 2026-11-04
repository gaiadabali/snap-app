import { randomUUID } from 'node:crypto';

import * as oidc from 'openid-client';

import { config, yourtalApiUrl, yourtalEventsClientId } from '../config.js';
import { webClientKey } from '../auth/yourtal-signin/settings.js';

/**
 * YourTal's teen invite API (yourtal docs/26 §3.3; the 3.9.e report's "What
 * SnapApp's 3.10 must do"). SnapApp's SERVER client (`snapapp-staging-server`,
 * YOURTAL_OIDC_SERVER_CLIENT_ID) gets a client-credentials token for scope
 * `teen_invites`, authenticating with `private_key_jwt` and the same key as
 * the website client (YOURTAL_OIDC_KEY_FILE), so YourTal registers that one
 * public key for both. The token lasts 10 minutes and is reused until a
 * minute before it ends.
 *
 * Never logs a code or a token. A refusal comes back as a reason; YourTal
 * being down or answering something unexpected is `unavailable`.
 */

const SCOPE = 'teen_invites';
const PATH = '/api/oidc-clients/teen-invites';
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** On when the issuer, the server client id and the key file are all set. */
export function teenInvitesConfigured(): boolean {
  const settings = config();
  return Boolean(settings.YOURTAL_OIDC_ISSUER && settings.YOURTAL_OIDC_KEY_FILE && yourtalEventsClientId());
}

let discovered: { key: string; at: number; config: Promise<oidc.Configuration> } | null = null;
let token: { key: string; value: string; expiresAt: number } | null = null;

/** Tests only. */
export function resetTeenInviteApiCache(): void {
  discovered = null;
  token = null;
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

async function accessToken(): Promise<string> {
  const key = `${config().YOURTAL_OIDC_ISSUER} ${yourtalEventsClientId()}`;
  if (token && token.key === key && Date.now() < token.expiresAt - 60_000) return token.value;
  const response = await oidc.clientCredentialsGrant(await configuration(), { scope: SCOPE });
  const lifetime = (response.expires_in ?? 600) * 1000;
  token = { key, value: response.access_token, expiresAt: Date.now() + lifetime };
  return token.value;
}

type Answer = { status: number; body: Record<string, unknown> } | null;

/** One call with the bearer token; a 401 drops the cached token and tries once more. Null when YourTal is unreachable. */
async function call(method: 'GET' | 'POST', path: string, body?: object, idempotencyKey?: string): Promise<Answer> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${yourtalApiUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
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
      token = null;
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

export type CreateInviteResult =
  | { ok: true; inviteId: string; code: string; expiresAt: string }
  | { ok: false; reason: 'parent_not_eligible' | 'too_many_invites' | 'unavailable' };

/**
 * `POST /teen-invites` with `{ parentSub }`. A network failure is retried
 * once under the same Idempotency-Key; a replay answers without `code` (it
 * is never stored), and then a NEW invite is made under a new key.
 */
export async function createTeenInvite(parentSub: string): Promise<CreateInviteResult> {
  let key = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let answer: Answer;
    try {
      answer = await call('POST', PATH, { parentSub }, key);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (!answer || answer.status >= 500) continue;
    const { status, body } = answer;
    if (status === 201 || status === 200) {
      const { inviteId, code, expiresAt } = body;
      if (typeof inviteId !== 'string' || !UUID.test(inviteId) || typeof expiresAt !== 'string') {
        return { ok: false, reason: 'unavailable' };
      }
      if (typeof code !== 'string' || code.length === 0) {
        key = randomUUID(); // a replay: the code is gone, make a new invite
        continue;
      }
      return { ok: true, inviteId: inviteId.toLowerCase(), code, expiresAt };
    }
    if (status === 403 && body.code === 'parent_not_eligible') return { ok: false, reason: 'parent_not_eligible' };
    if (status === 429) return { ok: false, reason: 'too_many_invites' };
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: false, reason: 'unavailable' };
}

export type InviteState = { status: 'pending' | 'accepted' | 'expired' | 'ended'; teenSub: string | null };

/** `GET /teen-invites/{id}`. Null when YourTal cannot say (down, unknown invite, odd answer). */
export async function readTeenInvite(inviteId: string): Promise<InviteState | null> {
  let answer: Answer;
  try {
    answer = await call('GET', `${PATH}/${encodeURIComponent(inviteId)}`);
  } catch {
    return null;
  }
  if (!answer || answer.status !== 200) return null;
  const { status, teenSub } = answer.body;
  if (status !== 'pending' && status !== 'accepted' && status !== 'expired' && status !== 'ended') return null;
  return { status, teenSub: typeof teenSub === 'string' ? teenSub : null };
}

/** `POST /teen-invites/{id}/end` with `{ parentSub }`. True on 200 (ending twice is 200 too). */
export async function endTeenInvite(inviteId: string, parentSub: string): Promise<boolean> {
  const key = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let answer: Answer;
    try {
      answer = await call('POST', `${PATH}/${encodeURIComponent(inviteId)}/end`, { parentSub }, key);
    } catch {
      return false;
    }
    if (answer && answer.status === 200) return true;
    if (answer && answer.status < 500) return false;
  }
  return false;
}
