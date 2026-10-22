import { yourtalApiUrl, yourtalMerchantCredential } from '../config.js';
import { MERCHANT_IDEMPOTENCY_HEADER, MERCHANT_SIGNATURE_HEADER, signMerchantRequest } from './merchant-signing.js';

/**
 * Snap Apps as a merchant of YourTal's voucher API (`POST /v1/vouchers/...`),
 * signed with `X-YourTal-Signature` (see `merchant-signing.ts`).
 *
 * Thin like the partner client: it signs and sends the bytes it is given, and
 * turns whatever comes back into one of three shapes; what an answer MEANS is
 * the caller's call. Never throws on a non-2xx, and never logs or returns in an
 * error string a request body, a voucher code, the secret or the signature.
 */

export type MerchantResult =
  | { kind: 'ok'; status: number; body: Record<string, unknown>; replay: boolean }
  | {
      kind: 'error';
      status: number;
      /** From `{error:{code}}`, when the body had one. */
      code: string | null;
      message: string | null;
      replay: boolean;
    }
  | { kind: 'network'; error: string };

export interface MerchantSettings {
  /** Origin only, no trailing slash. */
  baseUrl: string;
  keyId: string;
  /** 32 raw bytes. */
  secret: Uint8Array;
  timeoutMs?: number;
}

export interface AuthorizeInput {
  /** The canonical voucher code. */
  code: string;
  amountMinor: number;
  currency: string;
  merchantOrderRef: string;
  orderTotalMinor?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export const MERCHANT_PATHS = {
  authorize: '/v1/vouchers/authorize',
  capture: '/v1/vouchers/capture',
  void: '/v1/vouchers/void',
  lookup: '/v1/vouchers/lookup',
} as const;

export class YourtalMerchantClient {
  constructor(
    private readonly settings: MerchantSettings,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  authorize(input: AuthorizeInput, idempotencyKey: string): Promise<MerchantResult> {
    const body: Record<string, unknown> = {
      code: input.code,
      amount: input.amountMinor,
      currency: input.currency,
      merchant_order_ref: input.merchantOrderRef,
    };
    if (input.orderTotalMinor !== undefined) body.order_total = input.orderTotalMinor;
    return this.post(MERCHANT_PATHS.authorize, JSON.stringify(body), idempotencyKey);
  }

  capture(
    input: { authorizationId: string; finalAmountMinor: number },
    idempotencyKey: string,
  ): Promise<MerchantResult> {
    return this.post(
      MERCHANT_PATHS.capture,
      JSON.stringify({ authorization_id: input.authorizationId, final_amount: input.finalAmountMinor }),
      idempotencyKey,
    );
  }

  void(input: { authorizationId: string }, idempotencyKey: string): Promise<MerchantResult> {
    return this.post(MERCHANT_PATHS.void, JSON.stringify({ authorization_id: input.authorizationId }), idempotencyKey);
  }

  /** `{merchant_order_ref}` to `{authorization_id, state, amount_authorized, expires_at, receipt_id?, amount_captured?}`. */
  lookup(input: { merchantOrderRef: string }, idempotencyKey: string): Promise<MerchantResult> {
    return this.post(
      MERCHANT_PATHS.lookup,
      JSON.stringify({ merchant_order_ref: input.merchantOrderRef }),
      idempotencyKey,
    );
  }

  /** POST `rawBody` (exactly these bytes, signed) to `path` under `idempotencyKey`. */
  private async post(path: string, rawBody: string, idempotencyKey: string): Promise<MerchantResult> {
    if (!idempotencyKey) throw new Error('merchant calls require an Idempotency-Key');
    const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          [MERCHANT_SIGNATURE_HEADER]: signMerchantRequest({
            secret: this.settings.secret,
            keyId: this.settings.keyId,
            method: 'POST',
            pathAndQuery: path,
            idempotencyKey,
            body: rawBody,
            timestamp: this.now(),
          }),
          'Content-Type': 'application/json',
          [MERCHANT_IDEMPOTENCY_HEADER]: idempotencyKey,
        },
        body: rawBody,
        redirect: 'error',
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'network', error: describe(error) };
    }

    const replay = response.headers.get('Idempotent-Replay')?.toLowerCase() === 'true';
    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const body = isRecord(parsed) ? parsed : {};

    if (response.ok) return { kind: 'ok', status: response.status, body, replay };
    const err = isRecord(body.error) ? body.error : {};
    return {
      kind: 'error',
      status: response.status,
      code: typeof err.code === 'string' ? err.code : null,
      message: typeof err.message === 'string' ? err.message.slice(0, 500) : null,
      replay,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return `${error.name}: ${error.message}${cause?.code ? ` (${cause.code})` : ''}`.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

/** A client from this deployment's configuration, or `null` when the merchant credential is not set. */
export function yourtalMerchantClient(): YourtalMerchantClient | null {
  const credential = yourtalMerchantCredential();
  if (!credential) return null;
  return new YourtalMerchantClient({ baseUrl: yourtalApiUrl(), ...credential });
}
