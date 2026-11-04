import { randomUUID } from 'node:crypto';

import { oidcApiCall, oidcClientConfigured, resetOidcClientApiCache, type Answer } from '../yourtal/oidc-client-api.js';

/**
 * YourTal's teen invite API (yourtal docs/26 §3.3; the 3.9.e report's "What
 * SnapApp's 3.10 must do"), scope `teen_invites`. The token and call code is
 * yourtal/oidc-client-api.ts.
 *
 * Never logs a code or a token. A refusal comes back as a reason; YourTal
 * being down or answering something unexpected is `unavailable`.
 */

const SCOPE = 'teen_invites';
const PATH = '/api/oidc-clients/teen-invites';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** On when the issuer, the server client id and the key file are all set. */
export const teenInvitesConfigured = oidcClientConfigured;

/** Tests only. */
export const resetTeenInviteApiCache = resetOidcClientApiCache;

const call = (method: 'GET' | 'POST', path: string, body?: object, idempotencyKey?: string): Promise<Answer> =>
  oidcApiCall(SCOPE, method, path, body, idempotencyKey);

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

/**
 * `POST /teen-invites/{id}/end` with `{ parentSub }`. `ended` on 200 (ending
 * twice is 200 too) and on 404 (YourTal no longer has it: nothing left to
 * end); `failed` otherwise, for the caller to retry later.
 */
export async function endTeenInvite(inviteId: string, parentSub: string): Promise<'ended' | 'failed'> {
  const key = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let answer: Answer;
    try {
      answer = await call('POST', `${PATH}/${encodeURIComponent(inviteId)}/end`, { parentSub }, key);
    } catch {
      return 'failed';
    }
    if (answer && (answer.status === 200 || answer.status === 404)) return 'ended';
    if (answer && answer.status < 500) return 'failed';
  }
  return 'failed';
}
