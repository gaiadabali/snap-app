import { oidcApiBytes, oidcApiCall } from '../../yourtal/oidc-client-api.js';
import { SPAMBANK_PATH, SPAMBANK_SCOPE } from '../yourtal-mail.js';
import { MAILED_STATEMENT_MAX_BYTES } from './statement-event.js';

/**
 * SnapApp's two calls to YourTal for a mailed statement (spambank/BUILD.md
 * §5.2, §4.8 steps 4-5), as SnapApp's server client with scope `spambank`:
 *
 *   POST /api/oidc-clients/spambank/attachments/fetch {sub, emailId, blobId}
 *        the raw bytes of an OFFERED file (YourTal answers 404 for any other)
 *   POST /api/oidc-clients/spambank/statements/ack   {sub, emailId, blobId, outcome, detail?}
 *        what SnapApp did with it; 204
 *
 * Never logs a body, a `sub` or the bytes.
 */

export type FetchedFile =
  | { state: 'ok'; bytes: Buffer; contentType: string | null }
  /** YourTal no longer offers this file (404 `not_found`): purged, or never offered. */
  | { state: 'not_offered' }
  /** The person cannot be served any more: unknown `sub`, consent ended, a teen, no mailbox. */
  | { state: 'not_allowed' }
  /** YourTal refused the request itself (another 4xx): a bug or a misconfiguration; retrying will not help. */
  | { state: 'rejected'; status: number }
  /** Worth another try later: YourTal or its mail server down, rate limited, unreachable. */
  | { state: 'unavailable'; status: number | null };

/** The person's offered file. `maxBytes` defaults to just over the 10 MB offer limit. */
export async function fetchOfferedFile(
  sub: string,
  emailId: string,
  blobId: string,
  maxBytes = MAILED_STATEMENT_MAX_BYTES + 64 * 1024,
): Promise<FetchedFile> {
  let answer: Awaited<ReturnType<typeof oidcApiBytes>>;
  try {
    answer = await oidcApiBytes(SPAMBANK_SCOPE, 'POST', `${SPAMBANK_PATH}/attachments/fetch`, { sub, emailId, blobId }, { maxBytes });
  } catch {
    return { state: 'unavailable', status: null };
  }
  // Null is "unreachable" or "larger than maxBytes". The caller has already
  // refused a file the offer says is over 10 MB, so this is the former.
  if (!answer) return { state: 'unavailable', status: null };
  if (answer.status === 200) return { state: 'ok', bytes: answer.bytes, contentType: answer.contentType };
  const code = codeOf(answer.bytes);
  if (answer.status === 404 && code === 'not_found') return { state: 'not_offered' };
  if ((answer.status === 404 && code === 'unknown_subject') || answer.status === 403 || answer.status === 409) {
    return { state: 'not_allowed' };
  }
  if (answer.status === 429 || answer.status >= 500) return { state: 'unavailable', status: answer.status };
  return { state: 'rejected', status: answer.status };
}

export type AckOutcome = 'imported' | 'duplicate' | 'failed' | 'skipped';

/**
 * Tells YourTal what happened. `done` also for a 4xx other than 429 (YourTal
 * no longer knows the offer or the person, or refused the request): asking
 * again would not change the answer. `retry` for anything transient.
 */
export async function ackStatement(
  sub: string,
  emailId: string,
  blobId: string,
  outcome: AckOutcome,
  detail: string | null,
): Promise<'done' | 'retry'> {
  let answer: Awaited<ReturnType<typeof oidcApiCall>>;
  try {
    answer = await oidcApiCall(SPAMBANK_SCOPE, 'POST', `${SPAMBANK_PATH}/statements/ack`, {
      sub,
      emailId,
      blobId,
      outcome,
      ...(detail ? { detail: detail.slice(0, 500) } : {}),
    });
  } catch {
    return 'retry';
  }
  if (!answer) return 'retry';
  if (answer.status === 429 || answer.status >= 500) return 'retry';
  return 'done';
}

/** The `code` of a small JSON error body, or null. */
function codeOf(bytes: Buffer): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > 4096) return null;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}
