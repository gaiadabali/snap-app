import { readFileSync } from 'node:fs';

import { SignJWT, importPKCS8 } from 'jose';

import { simulationMode, type Env } from '../integrations/simulation.js';

/**
 * Firebase Cloud Messaging, server side (Spambank BUILD.md B9, §4.9): the
 * phone's "You have 3 new emails". Direct FCM HTTP v1, no Expo account.
 *
 * Two senders, one chosen by config, never both (`integrations/simulation.ts`):
 *
 *   real       FCM_SERVICE_ACCOUNT_FILE names a service-account JSON on the host
 *              AND FCM_PROJECT_ID names the project. Each send is a POST to
 *              `fcm.googleapis.com/v1/projects/{project}/messages:send` with a
 *              bearer token minted from that key (a signed JWT exchanged at
 *              Google's token endpoint, as `credits/google-play.ts` does).
 *   simulated  FCM_SIMULATOR=true on a non-production or demo host: records what
 *              it would send and answers as FCM does (tests, dev).
 *   absent     neither: `fcmSender()` returns null and the caller drops the
 *              alert. The Firebase project may not exist yet; nothing breaks.
 *
 * A half-configured pair (a key file without a project id) is `absent` too, and
 * said once in the log. A token is NEVER logged: an FCM registration token plus
 * our sender key can notify that phone.
 *
 * What a send answers (never throws for a delivery outcome):
 *   sent          FCM accepted it.
 *   unregistered  FCM says the token is dead (`UNREGISTERED` / `NOT_FOUND`):
 *                 the caller deletes it.
 *   failed        anything else, with `retryable`: FCM or the network is down
 *                 (429, 5xx, a timeout), or our credentials are wrong (401/403:
 *                 the cached access token is dropped and the next send mints a
 *                 new one). A 400 that is not an unregistered token is NOT
 *                 retryable, and does NOT delete the token: it may be our
 *                 payload that is wrong, and deleting tokens over a bug would
 *                 silence every phone.
 */

export interface FcmMessage {
  /** The phone's registration token. */
  token: string;
  title: string;
  body: string;
  /** String values only (FCM's rule). */
  data?: Record<string, string>;
  /** The Android notification channel (T14 creates `mail`). */
  channelId?: string;
}

export type FcmResult =
  | { state: 'sent' }
  | { state: 'unregistered' }
  | { state: 'failed'; retryable: boolean; status: number | null; code: string | null };

export interface FcmSender {
  readonly mode: 'real' | 'simulated';
  send(message: FcmMessage): Promise<FcmResult>;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 10_000;

export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type Fetch = typeof fetch;

/** The real FCM HTTP v1 sender. */
export class FcmHttpV1Sender implements FcmSender {
  readonly mode = 'real' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly projectId: string,
    private readonly http: Fetch = fetch,
  ) {}

  async send(message: FcmMessage): Promise<FcmResult> {
    let response: Response;
    try {
      response = await this.http(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: { title: message.title, body: message.body },
            ...(message.data ? { data: message.data } : {}),
            android: {
              priority: 'HIGH',
              ...(message.channelId ? { notification: { channel_id: message.channelId } } : {}),
            },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The network, a timeout, or the token exchange: ours to retry.
      return { state: 'failed', retryable: true, status: null, code: null };
    }
    if (response.ok) return { state: 'sent' };

    const { status, code } = await errorOf(response);
    if (status === 404 || code === 'UNREGISTERED' || code === 'NOT_FOUND') return { state: 'unregistered' };
    if (status === 401 || status === 403) {
      // Our credentials, or a revoked sender: drop the cached token and try again later.
      this.token = null;
      return { state: 'failed', retryable: true, status, code };
    }
    return { state: 'failed', retryable: status === 429 || status >= 500, status, code };
  }

  /** OAuth 2.0 for service accounts: a signed JWT exchanged for an access token. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const tokenUri = this.account.token_uri ?? DEFAULT_TOKEN_URI;
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.account.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(await importPKCS8(this.account.private_key, 'RS256'));
    const res = await this.http(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Google OAuth token exchange answered ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}

/** FCM's error body: `{ error: { code, status, details: [{ errorCode }] } }`. The message is never read. */
async function errorOf(response: Response): Promise<{ status: number; code: string | null }> {
  try {
    const body = (await response.json()) as {
      error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> };
    };
    const detail = body.error?.details?.find((d) => typeof d.errorCode === 'string')?.errorCode;
    const code = typeof detail === 'string' ? detail : typeof body.error?.status === 'string' ? body.error.status : null;
    return { status: response.status, code };
  } catch {
    return { status: response.status, code: null };
  }
}

/**
 * The simulated FCM: remembers what it was asked to send, and answers
 * `unregistered` for a token a test marked dead, `failed` for the next `n`
 * sends when told to. It accepts anything else.
 */
export class SimulatedFcm implements FcmSender {
  readonly mode = 'simulated' as const;
  /** Every message handed to `send`, in order. */
  readonly sent: FcmMessage[] = [];
  private readonly dead = new Set<string>();
  private failures = 0;
  private failureRetryable = true;

  /** FCM now answers `UNREGISTERED` for this token. */
  killToken(token: string): void {
    this.dead.add(token);
  }

  /** The next `count` sends fail (`retryable`: as 503, else as 400) before any are delivered. */
  failNext(count: number, retryable = true): void {
    this.failures = count;
    this.failureRetryable = retryable;
  }

  async send(message: FcmMessage): Promise<FcmResult> {
    this.sent.push(message);
    if (this.dead.has(message.token)) return { state: 'unregistered' };
    if (this.failures > 0) {
      this.failures -= 1;
      return this.failureRetryable
        ? { state: 'failed', retryable: true, status: 503, code: 'UNAVAILABLE' }
        : { state: 'failed', retryable: false, status: 400, code: 'INVALID_ARGUMENT' };
    }
    return { state: 'sent' };
  }
}

/**
 * The process-wide simulator, so the worker, the API and a test that reads it
 * all see the same record. Only built when the simulator is the chosen mode.
 */
let simulator: SimulatedFcm | null = null;

/** The simulator in use, or a fresh one. Tests read `.sent` from it. */
export function simulatedFcm(): SimulatedFcm {
  simulator ??= new SimulatedFcm();
  return simulator;
}

/** Tests only. */
export function resetFcmForTesting(): void {
  simulator = null;
  real = null;
  warned = false;
}

let real: { key: string; sender: FcmSender } | null = null;
let warned = false;

/** Reads and checks a service-account JSON; null (and no throw) when it is unreadable or not one. */
export function loadFcmServiceAccount(path: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      ...(typeof parsed.token_uri === 'string' ? { token_uri: parsed.token_uri } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The sender this deployment is configured for, or null when push is off.
 * Read per call (cheap), so a key placed after boot needs no restart.
 * `env` and `http` are for tests (config.ts documents the variables).
 */
export function fcmSender(env: Env = process.env, http: Fetch = fetch): FcmSender | null {
  const mode = simulationMode('fcm', env);
  if (mode === 'simulated') return simulatedFcm();
  if (mode === 'absent') return null;

  // `real`: the key file is named. The project id must be too.
  const keyFile = env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  const projectId = env.FCM_PROJECT_ID?.trim();
  if (!keyFile || !projectId) {
    if (!warned) {
      warned = true;
      console.warn('fcm: FCM_SERVICE_ACCOUNT_FILE and FCM_PROJECT_ID must both be set; push notifications stay off');
    }
    return null;
  }
  const cacheKey = `${projectId} ${keyFile}`;
  if (real?.key === cacheKey) return real.sender;
  const account = loadFcmServiceAccount(keyFile);
  if (!account) {
    if (!warned) {
      warned = true;
      console.warn('fcm: FCM_SERVICE_ACCOUNT_FILE is unreadable or is not a service-account key; push notifications stay off');
    }
    return null;
  }
  real = { key: cacheKey, sender: new FcmHttpV1Sender(account, projectId, http) };
  return real.sender;
}
