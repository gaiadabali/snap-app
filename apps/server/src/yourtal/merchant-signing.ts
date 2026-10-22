import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signing a request to YourTal's merchant (voucher) API: a port of
 * `packages/sdk-merchant/src/signing.ts` and the Go `merchantauth/signing.go`.
 *
 *   X-YourTal-Signature: t=<unix>,k=<key id>,v1=<hex hmac-sha256>
 *
 * over the newline-joined canonical string
 *   unix-seconds \n key-id \n METHOD \n path-and-query \n idempotency-key \n base64(sha256(body))
 * keyed with the 32 raw secret bytes. Serialise once, sign THOSE bytes, send
 * THOSE bytes.
 */
export const MERCHANT_SIGNATURE_HEADER = 'X-YourTal-Signature';
export const MERCHANT_IDEMPOTENCY_HEADER = 'Idempotency-Key';
/** The Go verifier's replay window, each way. */
export const MERCHANT_REPLAY_WINDOW_SECONDS = 5 * 60;

export interface MerchantSignInput {
  secret: Uint8Array;
  keyId: string;
  method: string;
  /** Path plus query exactly as sent. */
  pathAndQuery: string;
  /** `''` when the call carries none. */
  idempotencyKey: string;
  body: string | Uint8Array;
  /** Signed to the second. */
  timestamp: Date;
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

function mac(
  secret: Uint8Array,
  unixSeconds: number,
  keyId: string,
  method: string,
  pathAndQuery: string,
  idempotencyKey: string,
  body: string | Uint8Array,
): Buffer {
  const digest = createHash('sha256').update(toBytes(body)).digest('base64');
  const canonical = [unixSeconds, keyId, method.toUpperCase(), pathAndQuery, idempotencyKey, digest].join('\n');
  return createHmac('sha256', secret).update(canonical, 'utf8').digest();
}

/** The `X-YourTal-Signature` header value. */
export function signMerchantRequest(input: MerchantSignInput): string {
  const unixSeconds = Math.floor(input.timestamp.getTime() / 1000);
  const digest = mac(
    input.secret,
    unixSeconds,
    input.keyId,
    input.method,
    input.pathAndQuery,
    input.idempotencyKey,
    input.body,
  );
  return `t=${unixSeconds},k=${input.keyId},v1=${digest.toString('hex')}`;
}

export type MerchantVerifyResult =
  | { ok: true; keyId: string }
  | { ok: false; reason: 'malformed' | 'wrong_key' | 'outside_window' | 'mismatch' };

/**
 * The receiving side, for the fake YourTal in tests (an independent check of
 * the signer, mirroring Go's `Parse` + `Verify`): window first, then the MAC in
 * constant time. `expectedKeyId` is the key the verifier knows the secret for.
 */
export function verifyMerchantSignature(args: {
  header: string | undefined;
  secret: Uint8Array;
  expectedKeyId: string;
  method: string;
  pathAndQuery: string;
  idempotencyKey: string;
  body: string | Uint8Array;
  now?: Date;
}): MerchantVerifyResult {
  let seconds: number | undefined;
  let keyId = '';
  let given: Buffer | undefined;
  for (const part of (args.header ?? '').split(',')) {
    const trimmed = part.trim();
    const at = trimmed.indexOf('=');
    if (at < 0) return { ok: false, reason: 'malformed' };
    const name = trimmed.slice(0, at);
    const value = trimmed.slice(at + 1);
    if (name === 't') {
      if (!/^-?\d+$/.test(value)) return { ok: false, reason: 'malformed' };
      seconds = Number(value);
    } else if (name === 'k') keyId = value;
    else if (name === 'v1') {
      if (!/^[0-9a-f]{64}$/i.test(value)) return { ok: false, reason: 'malformed' };
      given = Buffer.from(value, 'hex');
    }
  }
  if (seconds === undefined || !keyId || !given) return { ok: false, reason: 'malformed' };

  const nowSeconds = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > MERCHANT_REPLAY_WINDOW_SECONDS) return { ok: false, reason: 'outside_window' };
  if (keyId !== args.expectedKeyId) return { ok: false, reason: 'wrong_key' };

  const expected = mac(args.secret, seconds, keyId, args.method, args.pathAndQuery, args.idempotencyKey, args.body);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? { ok: true, keyId }
    : { ok: false, reason: 'mismatch' };
}
