import { randomUUID } from 'node:crypto';

import { YOURTAL_PATHS, type PartnerResponse, type YourtalPartnerClient } from './client.js';
import type { YourtalRegion } from './links.repo.js';

/**
 * The two calls made INSIDE a user's request: exchanging a link code, and
 * revoking a link. Unlike a receipt report, the user is waiting on these, so
 * they get a short, bounded retry (same key, same bytes) and then an honest
 * "YourTal is unavailable, try again" rather than a queue.
 */

const ATTEMPT_DELAYS_MS = [0, 400, 1200];
/** A 429 asking for longer than this is answered "try again later" now. */
const MAX_INLINE_RETRY_AFTER_SECONDS = 2;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryableInline(r: PartnerResponse): boolean {
  if (r.kind === 'network') return true;
  if (r.kind === 'ok') return false;
  if (r.status >= 500 || r.status === 408) return true;
  if (r.status === 409 && r.code === 'idempotency_request_in_progress') return true;
  if (r.status === 429) return (r.retryAfterSeconds ?? 0) <= MAX_INLINE_RETRY_AFTER_SECONDS;
  return false;
}

async function postWithInlineRetry(
  client: YourtalPartnerClient,
  path: string,
  rawBody: string,
  sleep: Sleep,
): Promise<PartnerResponse> {
  const key = randomUUID();
  let last: PartnerResponse = { kind: 'network', error: 'not attempted' };
  for (const delay of ATTEMPT_DELAYS_MS) {
    if (delay > 0) {
      const ask = last.kind === 'error' && last.status === 429 ? (last.retryAfterSeconds ?? 0) * 1000 : 0;
      await sleep(Math.max(delay, ask));
    }
    last = await client.post(path, rawBody, key);
    if (!retryableInline(last)) return last;
  }
  return last;
}

export type ExchangeResult =
  | { ok: true; linkId: string; region: YourtalRegion }
  | {
      ok: false;
      reason: 'invalid_link_code' | 'teen_consent_not_allowed' | 'unavailable' | 'rejected';
      /** For the log only. Never shown to the user verbatim. */
      detail: string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the user typed, made into what YourTal issued: the code is letters and
 * digits, shown in YourTal in capitals. People paste it with spaces or a
 * hyphen, or type it in lower case. Returns null for something that cannot be
 * a code at all, so a typo costs neither YourTal's rate limit nor ours.
 */
export function normaliseLinkCode(input: string): string | null {
  const code = input.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}

export async function exchangeLinkCode(
  client: YourtalPartnerClient,
  code: string,
  sleep: Sleep = realSleep,
): Promise<ExchangeResult> {
  const r = await postWithInlineRetry(client, YOURTAL_PATHS.links, JSON.stringify({ code }), sleep);

  if (r.kind === 'ok') {
    const linkId = r.body.linkId;
    const region = r.body.region;
    if (typeof linkId === 'string' && UUID.test(linkId) && (region === 'AU' || region === 'ID')) {
      return { ok: true, linkId: linkId.toLowerCase(), region };
    }
    return { ok: false, reason: 'rejected', detail: `200 with an unexpected body shape` };
  }
  if (r.kind === 'network') return { ok: false, reason: 'unavailable', detail: r.error };

  const detail = `${r.status} ${r.code ?? '(no code)'}`;
  if (r.status === 400 && r.code === 'invalid_link_code') return { ok: false, reason: 'invalid_link_code', detail };
  if (r.status === 403 && r.code === 'teen_consent_not_allowed') {
    return { ok: false, reason: 'teen_consent_not_allowed', detail };
  }
  if (retryableInline(r) || r.status === 429) return { ok: false, reason: 'unavailable', detail };
  // 401 (our credentials), a validation 400, anything else: our fault or
  // theirs, not the user's, and retrying the same thing will not help.
  return { ok: false, reason: 'rejected', detail };
}

export type RevokeResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'rejected'; detail: string };

/**
 * Ends the link at YourTal. Already revoked answers 200 (YourTal keeps the
 * first revokedAt), and `unknown_link` / `link_revoked` mean there is nothing
 * left to end — all three are success for the caller, which then marks the
 * link revoked here.
 */
export async function revokeLinkAtYourtal(
  client: YourtalPartnerClient,
  linkId: string,
  sleep: Sleep = realSleep,
): Promise<RevokeResult> {
  const r = await postWithInlineRetry(client, YOURTAL_PATHS.revoke(linkId), '{}', sleep);
  if (r.kind === 'ok') return { ok: true };
  if (r.kind === 'network') return { ok: false, reason: 'unavailable', detail: r.error };
  if ((r.status === 400 && r.code === 'unknown_link') || (r.status === 403 && r.code === 'link_revoked')) {
    return { ok: true };
  }
  const detail = `${r.status} ${r.code ?? '(no code)'}`;
  if (retryableInline(r) || r.status === 429) return { ok: false, reason: 'unavailable', detail };
  return { ok: false, reason: 'rejected', detail };
}
