import { readFileSync } from 'node:fs';

import { Logger } from '@nestjs/common';
import { calculateJwkThumbprint, exportJWK, importJWK, importPKCS8, type JWK } from 'jose';

import { config } from '../../config.js';

/**
 * Settings for "Sign in with YourTal" (group task 3.3; the contract is
 * yourtal/docs/26-sign-in-with-yourtal.md §1.9).
 *
 * Two clients, one sector at YourTal (so both see the same `sub`):
 *   web     snapapp-staging-web     confidential, private_key_jwt, https redirect
 *   mobile  snapapp-staging-mobile  public (`none`), PKCE, private-use scheme redirect
 *
 * Each is ON only when the issuer and its client id are set; the web client
 * also needs its private key. Anything missing turns that client off — never
 * the API — so main keeps deploying while YourTal's provider is built.
 */
export type YourTalClientKind = 'web' | 'mobile';

export type YourTalClientSettings = {
  kind: YourTalClientKind;
  clientId: string;
  redirectUri: string;
};

export type YourTalSignInSettings = {
  issuer: URL;
  web?: YourTalClientSettings;
  mobile?: YourTalClientSettings;
};

/** The phone app's redirect: a reverse-DNS private-use scheme (RFC 8252 §7.1, docs/26 §1.9). */
export const DEFAULT_MOBILE_REDIRECT_URI = 'au.com.snapapps.app:/oauth/yourtal';

/** The scopes every sign-in asks for (docs/26 §1.4): `account` is required, for region and age band. */
export const YOURTAL_SCOPES = 'openid email profile account';

const logger = new Logger('yourtal-signin');

/** WebCrypto's key type, as jose returns it (the global is not in this tsconfig's lib). */
type CryptoKey = Awaited<ReturnType<typeof importPKCS8>>;

/** What is configured right now. Null when the feature is off altogether. */
export function yourtalSignInSettings(): YourTalSignInSettings | null {
  const settings = config();
  if (!settings.YOURTAL_OIDC_ISSUER) return null;

  const issuer = new URL(settings.YOURTAL_OIDC_ISSUER);
  const result: YourTalSignInSettings = { issuer };

  if (settings.YOURTAL_OIDC_WEB_CLIENT_ID && webClientKeyStatus() === 'ok') {
    result.web = {
      kind: 'web',
      clientId: settings.YOURTAL_OIDC_WEB_CLIENT_ID,
      redirectUri:
        settings.YOURTAL_OIDC_WEB_REDIRECT_URI ??
        `${settings.WEB_PUBLIC_URL.replace(/\/+$/, '')}/auth/yourtal/callback`,
    };
  }
  if (settings.YOURTAL_OIDC_MOBILE_CLIENT_ID) {
    result.mobile = {
      kind: 'mobile',
      clientId: settings.YOURTAL_OIDC_MOBILE_CLIENT_ID,
      redirectUri: settings.YOURTAL_OIDC_MOBILE_REDIRECT_URI ?? DEFAULT_MOBILE_REDIRECT_URI,
    };
  }
  return result;
}

/** The settings for one client, or null when that client is off. */
export function yourtalClient(kind: YourTalClientKind): { issuer: URL; client: YourTalClientSettings } | null {
  const settings = yourtalSignInSettings();
  const client = settings?.[kind];
  return settings && client ? { issuer: settings.issuer, client } : null;
}

/* ── The web client's private key ────────────────────────────────────────────
 *
 * docs/26 §1.7: SnapApp's website authenticates to YourTal's token endpoint
 * with `private_key_jwt` — a short JWT signed with this key. YourTal holds
 * only the PUBLIC half (registered for `snapapp-staging-web`), so nothing
 * secret is shared with YourTal and nothing at YourTal can impersonate us.
 *
 * The file (YOURTAL_OIDC_KEY_FILE, host /etc/snap-apps/secrets/, mode 0600,
 * readable by uid 1001, mounted read-only) holds ONE private key, either:
 *   - a private JWK as JSON, with `kid` (and optionally `alg`: RS256, PS256
 *     or ES256; RS256 when absent), or
 *   - a PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`) for an RSA key, used with
 *     RS256 and the RFC 7638 thumbprint of its public half as `kid`.
 * `scripts/yourtal-oidc-key.ts` makes one and prints the public JWK to send
 * to YourTal. Never in the environment, never logged.
 */
export type WebClientKey = { key: CryptoKey; kid: string; alg: string; publicJwk: JWK };

const ALLOWED_ALGS = new Set(['RS256', 'PS256', 'ES256']);

let keyCache: { path: string; result: Promise<WebClientKey> } | null = null;
let keyStatusCache: {
  path: string | undefined;
  status: 'ok' | 'missing' | 'invalid';
  checkedAt: number;
} | null = null;

/** A key file that is missing or unusable is looked at again at most this often. */
const KEY_RECHECK_MS = 60 * 1000;

function readKeyFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Whether the key file is present and parses as a private key (cheap,
 * synchronous, no crypto; the full import happens on first use, in
 * `webClientKey()`). A good answer is kept; a missing or unusable file is
 * looked at again at most once a minute, so a key copied into place after
 * boot turns the website client on without a restart.
 */
function webClientKeyStatus(now: number = Date.now()): 'ok' | 'missing' | 'invalid' {
  const path = config().YOURTAL_OIDC_KEY_FILE;
  const cached = keyStatusCache;
  if (cached && cached.path === path && (cached.status === 'ok' || now - cached.checkedAt < KEY_RECHECK_MS)) {
    return cached.status;
  }

  let status: 'ok' | 'missing' | 'invalid';
  const text = path ? readKeyFile(path) : null;
  if (!text) {
    status = 'missing';
  } else if (text.startsWith('-----BEGIN PRIVATE KEY-----')) {
    status = 'ok';
  } else {
    try {
      const jwk = JSON.parse(text) as JWK;
      status = jwk && typeof jwk === 'object' && jwk.d && jwk.kid && (!jwk.alg || ALLOWED_ALGS.has(jwk.alg))
        ? 'ok'
        : 'invalid';
    } catch {
      status = 'invalid';
    }
  }
  const changed = !cached || cached.path !== path || cached.status !== status;
  if (changed && status !== 'ok' && config().YOURTAL_OIDC_WEB_CLIENT_ID) {
    // Said when it changes, not at every re-check, and never with the contents.
    logger.warn(
      `Sign in with YourTal: the website client is OFF — its private key file is ${status}` +
        ` (YOURTAL_OIDC_KEY_FILE${path ? ` = ${path}` : ' is unset'}).`,
    );
  }
  keyStatusCache = { path, status, checkedAt: now };
  return status;
}

/** The web client's signing key. Throws when it is missing or unusable. */
export function webClientKey(): Promise<WebClientKey> {
  const path = config().YOURTAL_OIDC_KEY_FILE;
  if (!path) return Promise.reject(new Error('YOURTAL_OIDC_KEY_FILE is not set'));
  if (keyCache && keyCache.path === path) return keyCache.result;
  const result = loadKey(path);
  keyCache = { path, result };
  // A failed load is not cached: the next sign-in tries again (a file
  // copied into place after boot starts working without a restart).
  result.catch(() => {
    if (keyCache?.result === result) keyCache = null;
  });
  return result;
}

async function loadKey(path: string): Promise<WebClientKey> {
  const text = readKeyFile(path);
  if (!text) throw new Error('the YourTal sign-in key file is missing or unreadable');
  return parsePrivateKey(text);
}

/** A private key file's contents (a private JWK, or an RSA PKCS#8 PEM) as a signing key. Never logs it. */
export async function parsePrivateKey(text: string): Promise<WebClientKey> {
  if (text.startsWith('-----BEGIN PRIVATE KEY-----')) {
    const alg = 'RS256';
    const key = (await importPKCS8(text, alg, { extractable: true })) as CryptoKey;
    const full = await exportJWK(key);
    const publicJwk = publicHalf(full);
    const kid = await calculateJwkThumbprint(publicJwk);
    return { key: await importPKCS8(text, alg), kid, alg, publicJwk: { ...publicJwk, kid, alg, use: 'sig' } };
  }

  const jwk = JSON.parse(text) as JWK;
  if (!jwk.d) throw new Error('the YourTal sign-in key file holds a public key, not a private one');
  if (!jwk.kid) throw new Error('the YourTal sign-in key file has no kid');
  const alg = jwk.alg ?? 'RS256';
  if (!ALLOWED_ALGS.has(alg)) throw new Error(`the YourTal sign-in key uses ${alg}; use RS256, PS256 or ES256`);
  const key = (await importJWK({ ...jwk, ext: false }, alg)) as CryptoKey;
  return { key, kid: jwk.kid, alg, publicJwk: { ...publicHalf(jwk), kid: jwk.kid, alg, use: 'sig' } };
}

/** The public members of a JWK: what YourTal registers. Never `d`, `p`, `q`, `dp`, `dq`, `qi`. */
export function publicHalf(jwk: JWK): JWK {
  if (jwk.kty === 'RSA') return { kty: 'RSA', n: jwk.n, e: jwk.e };
  if (jwk.kty === 'EC') return { kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y };
  throw new Error(`unsupported key type ${String(jwk.kty)}`);
}

/** Tests only: forget cached key state after changing YOURTAL_OIDC_KEY_FILE. */
export function resetYourTalKeyCache(): void {
  keyCache = null;
  keyStatusCache = null;
}
