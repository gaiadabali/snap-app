import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { config, yourtalEventsClientId } from '../config.js';

/**
 * Verifying YourTal's Security Event Tokens (RFC 8417, pushed per RFC 8935;
 * yourtal/docs/26 §2.3, docs/29 §4.3). Used twice: by the endpoint before it
 * stores an event, and by the worker before it acts on one, because the job
 * row is no trust boundary (docs/29 §6 S2). Only YourTal's RS256 signature is.
 *
 * jose does the work: the signature against the JWKS by `kid`, RS256 only
 * (no `none`, no HS confusion), exact `iss` and `aud`, and `typ`
 * `secevent+jwt` (an ID token cannot pass as a SET). The JWKS comes only from
 * the configured issuer's discovery document: no redirects, the document must
 * name that exact issuer, and `jwks_uri` must share its origin. jose never
 * reads `jku`, `x5u` or an embedded `jwk`.
 */

export const EVENT = {
  accountDeleted: 'urn:yourtal:event:account-deleted',
  accessEnded: 'urn:yourtal:event:access-ended',
} as const;

/** The job the worker acts from (docs/29 D2: SnapApp's inbox is `jobs`, keyed by the SET's jti). */
export const YOURTAL_EVENT_JOB = 'yourtal_event';

const MAX_AGE_S = 30 * 86_400;
const MAX_AHEAD_S = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC 8935's codes, plus `invalid_key`, which YourTal retries (the app may hold an old JWKS). */
export type SetError = 'invalid_request' | 'invalid_key' | 'invalid_issuer' | 'invalid_audience' | 'authentication_failed';

export type VerifiedSet = { jti: string; iat: number; sub: string; type: string; body: Record<string, unknown> };
export type SetResult =
  | { ok: true; set: VerifiedSet }
  | { ok: false; status: 400; err: SetError }
  | { ok: false; status: 503; reason: 'verification_unavailable' };

export type EventsSettings = { issuer: string; clientId: string };

/** Null while not configured: the endpoint answers 503 and the worker leaves its jobs queued. */
export function yourtalEventsSettings(): EventsSettings | null {
  const issuer = config().YOURTAL_OIDC_ISSUER;
  const clientId = yourtalEventsClientId();
  return issuer && clientId ? { issuer, clientId } : null;
}

let keys: { issuer: string; at: number; getKey: JWTVerifyGetKey } | undefined;
// A failed discovery is remembered for 30 s, so while YourTal is down a stream of junk cannot each start a fetch.
let failed: { issuer: string; at: number } | undefined;

/** Tests only. */
export function resetYourtalEventKeys(): void {
  keys = undefined;
  failed = undefined;
}

async function jwksFor(issuer: string): Promise<JWTVerifyGetKey> {
  if (keys?.issuer === issuer && Date.now() - keys.at < 10 * 60_000) return keys.getKey;
  if (failed?.issuer === issuer && Date.now() - failed.at < 30_000) throw new Error('discovery failed recently');
  try {
    const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const doc = (await res.json()) as { issuer?: unknown; jwks_uri?: unknown };
    if (
      !res.ok ||
      doc.issuer !== issuer ||
      typeof doc.jwks_uri !== 'string' ||
      new URL(doc.jwks_uri).origin !== new URL(issuer).origin
    ) {
      throw new Error('untrusted discovery document');
    }
    // On an unknown `kid` jose refetches the set (at most every 30 s), then throws JWKSNoMatchingKey.
    keys = { issuer, at: Date.now(), getKey: createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: 5000 }) };
    return keys.getKey;
  } catch (error) {
    failed = { issuer, at: Date.now() };
    throw error;
  }
}

const bad = (err: SetError): SetResult => ({ ok: false, status: 400, err });

export async function verifySet(token: string, settings: EventsSettings): Promise<SetResult> {
  const { issuer, clientId } = settings;
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, await jwksFor(issuer), {
      issuer,
      audience: clientId,
      typ: 'secevent+jwt',
      algorithms: ['RS256'],
    }));
  } catch (error) {
    if (error instanceof errors.JWKSNoMatchingKey) return bad('invalid_key');
    if (error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JOSEAlgNotAllowed) {
      return bad('authentication_failed');
    }
    if (error instanceof errors.JWTClaimValidationFailed) {
      return bad(error.claim === 'iss' ? 'invalid_issuer' : error.claim === 'aud' ? 'invalid_audience' : 'invalid_request');
    }
    if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid || error instanceof errors.JOSENotSupported) {
      return bad('invalid_request');
    }
    // Our side (discovery, the JWKS fetch or its timeout): not the token's fault, so YourTal must retry.
    return { ok: false, status: 503, reason: 'verification_unavailable' };
  }

  const now = Date.now() / 1000;
  const { iat, jti, sub_id: subId, events } = payload;
  if (typeof iat !== 'number' || iat > now + MAX_AHEAD_S || iat < now - MAX_AGE_S) return bad('invalid_request');
  // The jti is the job's id (docs/29 D2).
  if (typeof jti !== 'string' || !UUID.test(jti)) return bad('invalid_request');
  const sid = subId as { format?: unknown; iss?: unknown; sub?: unknown } | null | undefined;
  if (!sid || typeof sid !== 'object' || sid.format !== 'iss_sub' || typeof sid.sub !== 'string' || !sid.sub || sid.sub.length > 255) {
    return bad('invalid_request');
  }
  if (sid.iss !== issuer) return bad('invalid_issuer');
  const types = events && typeof events === 'object' ? Object.keys(events) : [];
  const body = types.length === 1 ? (events as Record<string, unknown>)[types[0]!] : null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('invalid_request'); // exactly one event
  return { ok: true, set: { jti: jti.toLowerCase(), iat, sub: sid.sub, type: types[0]!, body: body as Record<string, unknown> } };
}
