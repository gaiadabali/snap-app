import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signing a request to YourTal's partner API — `yourtal/docs/developers/
 * partner-api.md` §3.
 *
 *   Authorization: Partner <partner id>:<signature>
 *
 * `<signature>` is HMAC-SHA256 as 64 lowercase hex characters. The KEY is the
 * signing secret's UTF-8 bytes, used as given (never hex- or base64-decoded).
 * The MESSAGE is the exact bytes of the request body and nothing else: no
 * method, path, query or header.
 *
 * So the one rule every caller must keep is: serialise once, sign THOSE bytes,
 * send THOSE bytes. This module takes the raw body, never an object, so there
 * is no way to sign one serialisation and send another. The outbox goes one
 * step further and stores the body text, so a retry days later sends the same
 * bytes under the same Idempotency-Key.
 */

function bodyBytes(rawBody: string | Uint8Array): Buffer {
  return typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
}

/** The hex HMAC-SHA256 of `rawBody` under `secret`. */
export function partnerSignature(secret: string, rawBody: string | Uint8Array): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(bodyBytes(rawBody)).digest('hex');
}

/** The full `Authorization` header value. */
export function partnerAuthorization(partnerId: string, secret: string, rawBody: string | Uint8Array): string {
  return `Partner ${partnerId}:${partnerSignature(secret, rawBody)}`;
}

/**
 * The receiving side of the same rule: does `header` carry a valid signature
 * of `rawBody` for `partnerId`? Used by the fake YourTal in tests, so the
 * tests check the signer against an independent verifier rather than against
 * itself. Constant-time on the signature.
 */
export function verifyPartnerAuthorization(
  header: string | undefined,
  partnerId: string,
  secret: string,
  rawBody: string | Uint8Array,
): boolean {
  const match = /^Partner ([^:\s]+):([0-9a-f]{64})$/.exec(header ?? '');
  if (!match || match[1] !== partnerId) return false;
  const expected = Buffer.from(partnerSignature(secret, rawBody), 'hex');
  const given = Buffer.from(match[2]!, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
