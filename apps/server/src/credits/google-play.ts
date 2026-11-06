import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { simulationMode, type Env } from '../integrations/simulation.js';

/**
 * Google Play Billing, server side (group plan 8.3.b, founder ruling 0.12.b).
 *
 * In the Play build the phone buys a pack through Play and hands the server
 * the purchase token. Nothing on the phone is trusted: credits are granted
 * only after THIS driver has asked Google about the token. Two drivers, one
 * selected by config, never both (`integrations/simulation.ts`):
 *
 *   real       GOOGLE_PLAY_SERVICE_ACCOUNT_FILE names a service-account JSON
 *              on the host (/etc/snap-apps/secrets). Talks to the Play
 *              Developer API with a token minted from that key.
 *   simulated  GOOGLE_PLAY_SIMULATOR=true on a non-production or demo host.
 *              Knows only the tokens it issued itself (tests, dev).
 *   absent     neither: the endpoint says Play purchases are not connected.
 *
 * A production host that asks for the simulator is refused at boot
 * (`preflight.ts`, gate G-SIM), like every other simulator.
 */

/** `unknown`: anything Play does not plainly call purchased, pending or cancelled. Never acted on. */
export type PlayPurchaseState = 'purchased' | 'cancelled' | 'pending' | 'unknown';

/** What the server needs to know about one Play purchase. */
export interface PlayPurchase {
  productId: string;
  orderId: string | null;
  state: PlayPurchaseState;
  consumed: boolean;
  /** Set by the phone at purchase: the workspace id. */
  accountId: string | null;
  /** Set by the phone at purchase: the buyer's user id. */
  profileId: string | null;
  purchasedAtMs: number | null;
  /** A licence tester's test-card order: no money moved. */
  test: boolean;
  /** Units bought across all line items. Only 1 is sold. */
  quantity: number;
}

export interface GooglePlayDriver {
  readonly mode: 'real' | 'simulated';
  /** Null when Play does not know the token. */
  getPurchase(purchaseToken: string): Promise<PlayPurchase | null>;
  /** Consuming also acknowledges, and lets the same pack be bought again. */
  consume(productId: string, purchaseToken: string): Promise<void>;
  /** Whether Play has voided (refunded, charged back, revoked) the purchase. */
  isVoided(purchaseToken: string, purchase: PlayPurchase): Promise<boolean>;
}

export const DEFAULT_PACKAGE_NAME = 'au.com.snapapps.app';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
type Fetch = typeof fetch;

/** The real Play Developer API. */
export class GooglePlayApiDriver implements GooglePlayDriver {
  readonly mode = 'real' as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly packageName: string,
    private readonly http: Fetch = fetch,
  ) {}

  async getPurchase(purchaseToken: string): Promise<PlayPurchase | null> {
    // productsv2 takes the token alone, so a void notification (which names
    // no product) can be looked up too.
    const res = await this.call('GET', `/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`);
    // Play answers 400 or 404 for a token it does not know.
    if (res.status === 400 || res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error(`Google Play purchases.productsv2.get answered ${res.status}`);
    const body = (await res.json()) as {
      productLineItem?: {
        productId?: string;
        productOfferDetails?: { consumptionState?: string; quantity?: number };
      }[];
      testPurchaseContext?: { fopType?: string };
      purchaseStateContext?: { purchaseState?: string };
      orderId?: string;
      obfuscatedExternalAccountId?: string;
      obfuscatedExternalProfileId?: string;
      purchaseCompletionTime?: string;
    };
    const items = body.productLineItem ?? [];
    const item = items[0];
    if (!item?.productId) return null;
    const raw = body.purchaseStateContext?.purchaseState;
    const completed = body.purchaseCompletionTime ? Date.parse(body.purchaseCompletionTime) : NaN;
    return {
      productId: item.productId,
      orderId: body.orderId ?? null,
      state:
        raw === 'PURCHASED' ? 'purchased' : raw === 'PENDING' ? 'pending' : raw === 'CANCELLED' ? 'cancelled' : 'unknown',
      consumed: item.productOfferDetails?.consumptionState === 'CONSUMPTION_STATE_CONSUMED',
      accountId: body.obfuscatedExternalAccountId ?? null,
      profileId: body.obfuscatedExternalProfileId ?? null,
      purchasedAtMs: Number.isFinite(completed) ? completed : null,
      test: body.testPurchaseContext?.fopType === 'TEST',
      quantity: items.reduce((n, i) => n + (i.productOfferDetails?.quantity ?? 1), 0),
    };
  }

  async consume(productId: string, purchaseToken: string): Promise<void> {
    const res = await this.call(
      'POST',
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`,
    );
    if (!res.ok) throw new Error(`Google Play purchases.products.consume answered ${res.status}`);
  }

  async isVoided(purchaseToken: string, purchase: PlayPurchase): Promise<boolean> {
    if (purchase.state === 'cancelled') return true;
    // The Voided Purchases API keeps 30 days and refuses an older startTime.
    const since = Math.max(purchase.purchasedAtMs ?? 0, Date.now() - 29 * 24 * 3600 * 1000);
    let page: string | undefined;
    do {
      const q = new URLSearchParams({ startTime: String(since), maxResults: '1000' });
      if (page) q.set('token', page);
      const res = await this.call('GET', `/purchases/voidedpurchases?${q}`);
      if (!res.ok) throw new Error(`Google Play voidedpurchases.list answered ${res.status}`);
      const body = (await res.json()) as {
        voidedPurchases?: { purchaseToken?: string }[];
        tokenPagination?: { nextPageToken?: string };
      };
      if (body.voidedPurchases?.some((v) => v.purchaseToken === purchaseToken)) return true;
      page = body.tokenPagination?.nextPageToken;
    } while (page);
    return false;
  }

  private async call(method: 'GET' | 'POST', path: string): Promise<Response> {
    return this.http(`${API}/${encodeURIComponent(this.packageName)}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
  }

  /** OAuth 2.0 for service accounts: a signed JWT exchanged for an access token. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const tokenUri = this.account.token_uri ?? 'https://oauth2.googleapis.com/token';
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
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google OAuth token exchange answered ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}

/**
 * The simulated Play: an in-process store of the purchases it issued. It
 * accepts no token it did not mint, so a simulated host cannot be talked into
 * granting credits by a made-up token. Tokens live as long as the process.
 */
export class SimulatedGooglePlay implements GooglePlayDriver {
  readonly mode = 'simulated' as const;
  private readonly purchases = new Map<string, PlayPurchase & { voided: boolean }>();
  private orders = 0;

  /** What Play's billing sheet would hand the phone after a purchase. */
  issue(
    productId: string,
    ids: { accountId: string | null; profileId: string | null },
    state: PlayPurchaseState = 'purchased',
    extra: { test?: boolean; quantity?: number } = {},
  ): string {
    const token = `simplay.${randomUUID()}`;
    this.orders += 1;
    this.purchases.set(token, {
      productId,
      orderId: `GPA.SIM-${String(this.orders).padStart(4, '0')}`,
      state,
      consumed: false,
      accountId: ids.accountId,
      profileId: ids.profileId,
      purchasedAtMs: Date.now(),
      test: extra.test ?? false,
      quantity: extra.quantity ?? 1,
      voided: false,
    });
    return token;
  }

  /** A refund or chargeback in Play Console. */
  voidPurchase(purchaseToken: string): void {
    const p = this.purchases.get(purchaseToken);
    if (p) Object.assign(p, { voided: true, state: 'cancelled' });
  }

  async getPurchase(purchaseToken: string): Promise<PlayPurchase | null> {
    const p = this.purchases.get(purchaseToken);
    if (!p) return null;
    const { voided: _v, ...rest } = p;
    return { ...rest };
  }

  async consume(productId: string, purchaseToken: string): Promise<void> {
    const p = this.purchases.get(purchaseToken);
    if (!p || p.productId !== productId) throw new Error('simulated Play: no such purchase to consume');
    p.consumed = true;
  }

  async isVoided(purchaseToken: string): Promise<boolean> {
    return this.purchases.get(purchaseToken)?.voided ?? false;
  }
}

let cached: GooglePlayDriver | null | undefined;
let simulator: SimulatedGooglePlay | null = null;

/** The one simulated Play of this process. */
export function simulatedGooglePlay(): SimulatedGooglePlay {
  return (simulator ??= new SimulatedGooglePlay());
}

/** The driver config selects, or null when Play purchases are not connected. */
export function googlePlayDriver(env: Env = process.env): GooglePlayDriver | null {
  if (cached !== undefined) return cached;
  const mode = simulationMode('googleplay', env);
  if (mode === 'absent') return (cached = null);
  if (mode === 'simulated') return (cached = simulatedGooglePlay());
  // Not cached on failure: the next request tries again once the file is fixed.
  const account = loadServiceAccount(env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE!);
  return (cached = new GooglePlayApiDriver(account, env.GOOGLE_PLAY_PACKAGE_NAME ?? DEFAULT_PACKAGE_NAME));
}

/**
 * Reads the service-account key. Its errors never quote the file: a JSON
 * parse error carries the first characters of the input, which is the key.
 * `preflight.ts` calls this at boot, so a bad key fails the deploy.
 */
export function loadServiceAccount(file: string): ServiceAccount {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
    );
  }
  let account: Partial<ServiceAccount>;
  try {
    account = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_FILE is not JSON (expected the service-account key file)');
  }
  if (typeof account?.client_email !== 'string' || typeof account.private_key !== 'string') {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_FILE is not a service-account key (no client_email/private_key)');
  }
  return account as ServiceAccount;
}

/**
 * Who may push Play's notifications: Pub/Sub, signing an OIDC token as the
 * push subscription's service account (`GOOGLE_PLAY_RTDN_PUSH_ACCOUNT`) for
 * the audience set on that subscription (`GOOGLE_PLAY_RTDN_AUDIENCE`).
 * Throws on anything else, including either setting being absent.
 */
export async function verifyPushToken(authorization: string | undefined, env: Env = process.env): Promise<void> {
  const audience = env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const account = env.GOOGLE_PLAY_RTDN_PUSH_ACCOUNT;
  if (!audience || !account) throw new Error('GOOGLE_PLAY_RTDN_AUDIENCE and GOOGLE_PLAY_RTDN_PUSH_ACCOUNT are not set');
  const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
  if (!token) throw new Error('no bearer token');
  const { payload } = await jwtVerify(token, pushKeys(), {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience,
  });
  if (payload.email !== account || payload.email_verified !== true) {
    throw new Error('the token is not from the configured push service account');
  }
}

let googleKeys: JWTVerifyGetKey | null = null;
let testKeys: JWTVerifyGetKey | null = null;
function pushKeys(): JWTVerifyGetKey {
  return testKeys ?? (googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')));
}

/** Test-only: verify push tokens against these keys instead of Google's. */
export function setPushKeysForTesting(keys: JWTVerifyGetKey | null): void {
  testKeys = keys;
}

/** Test-only: forget the selected driver and the simulator's purchases. */
export function resetGooglePlayForTesting(): void {
  cached = undefined;
  simulator = null;
}
