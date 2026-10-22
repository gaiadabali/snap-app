import { randomUUID } from 'node:crypto';

import { config, yourtalApiUrl, yourtalPartnerSecret } from '../config.js';
import { partnerAuthorization } from './signing.js';

/**
 * The one place this server talks to YourTal's partner API.
 *
 * Deliberately thin: it signs and sends a body it is GIVEN as text, and turns
 * whatever comes back into one of three shapes. What a response MEANS (retry?
 * final? mark the link broken?) is decided by the caller, because the link
 * exchange inside a user's request and the outbox drain in the worker answer
 * that differently.
 *
 * Never logs, never throws on a non-2xx, never puts the secret or the
 * Authorization header into an error string.
 */

export type PartnerResponse =
  | { kind: 'ok'; status: number; body: Record<string, unknown> }
  | {
      kind: 'error';
      status: number;
      /** YourTal's stable error code (`link_revoked`, ...), when the body had one. */
      code: string | null;
      message: string | null;
      /** From a 429's body. */
      retryAfterSeconds: number | null;
      /** From an `identity_check_required` body: what the person still has to do. */
      missing?: string[];
    }
  | { kind: 'network'; error: string };

export interface YourtalPartnerSettings {
  /** Origin only, no `/api` and no trailing slash. */
  baseUrl: string;
  partnerId: string;
  secret: string;
  /** Per request. A hung YourTal must not hold a user's request or a drain slot. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class YourtalPartnerClient {
  constructor(
    private readonly settings: YourtalPartnerSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get partnerId(): string {
    return this.settings.partnerId;
  }

  /**
   * POST `rawBody` — exactly these bytes, signed — to `path` under
   * `idempotencyKey`. Retrying a request means calling this again with the
   * SAME body text and the SAME key.
   */
  async post(
    path: string,
    rawBody: string,
    idempotencyKey: string,
    options: { timeoutMs?: number } = {},
  ): Promise<PartnerResponse> {
    const url = `${this.settings.baseUrl.replace(/\/+$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: partnerAuthorization(this.settings.partnerId, this.settings.secret, rawBody),
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: rawBody,
        // A redirect would turn this POST into a GET to somewhere else and
        // still look like an answer. Treat it as the fault it is.
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: 'network', error: describe(error) };
    }

    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null; // an HTML error page from a proxy, say; the status still counts
    }
    const body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

    if (response.ok) return { kind: 'ok', status: response.status, body };
    return {
      kind: 'error',
      status: response.status,
      code: typeof body.code === 'string' ? body.code : null,
      message: typeof body.message === 'string' ? body.message.slice(0, 500) : null,
      retryAfterSeconds:
        typeof body.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)
          ? Math.max(0, body.retryAfterSeconds)
          : null,
      ...(Array.isArray(body.missing) ? { missing: body.missing.filter((m): m is string => typeof m === 'string').slice(0, 10) } : {}),
    };
  }
}

/**
 * What YourTal's `POST /api/partners/receipts/status` says about whether a
 * receipt would earn now (F127: SnapApp's receipt package is used up or not).
 * `remainingPoints` is YourTal's business data about Snap Apps' package: it is
 * read here and deliberately NOT carried any further.
 */
export interface ReceiptStatusAnswer {
  earning: boolean;
  pointsPerReceipt: number | null;
}

/** A shorter fuse than a report's: a user's page waits on this, at most once per cache fill. */
const RECEIPT_STATUS_TIMEOUT_MS = 3_000;

/**
 * Signed exactly as every other partner call (raw body, the same headers, a
 * fresh Idempotency-Key). Returns `null` for anything but a well-formed 200:
 * the caller treats that as "unknown", never as an error.
 */
export async function receiptStatus(
  client: YourtalPartnerClient,
  region: 'AU' | 'ID',
): Promise<ReceiptStatusAnswer | null> {
  const response = await client.post(YOURTAL_PATHS.receiptStatus, JSON.stringify({ region }), randomUUID(), {
    timeoutMs: RECEIPT_STATUS_TIMEOUT_MS,
  });
  if (response.kind !== 'ok' || typeof response.body.earning !== 'boolean') return null;
  const per = response.body.pointsPerReceipt;
  return {
    earning: response.body.earning,
    pointsPerReceipt: typeof per === 'number' && Number.isInteger(per) && per >= 0 ? per : null,
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return `${error.name}: ${error.message}${cause?.code ? ` (${cause.code})` : ''}`.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

/**
 * A client built from this deployment's configuration, or `null` when the
 * partner link is off (no `YOURTAL_PARTNER_ID`, or no secret). Built fresh by
 * each caller rather than cached, so a secret file rotated on the host is
 * picked up without a restart.
 */
export function yourtalPartnerClient(): YourtalPartnerClient | null {
  const partnerId = config().YOURTAL_PARTNER_ID;
  const secret = yourtalPartnerSecret();
  if (!partnerId || !secret) return null;
  return new YourtalPartnerClient({ baseUrl: yourtalApiUrl(), partnerId, secret });
}

/** YourTal's paths, relative to its origin. */
export const YOURTAL_PATHS = {
  links: '/api/partners/links',
  revoke: (linkId: string) => `/api/partners/links/${encodeURIComponent(linkId)}/revoke`,
  actions: '/api/partners/actions',
  receiptStatus: '/api/partners/receipts/status',
} as const;
