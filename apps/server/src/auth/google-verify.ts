import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Independent verification of a Google ID token.
 *
 * "Independent" is the whole point: the web app completes the OAuth + PKCE
 * exchange with Google and forwards the raw ID token here, but this module
 * does not trust the web app's word that the token is genuine. It re-derives
 * every fact for itself — signature against Google's own published keys,
 * issuer, audience, expiry, and the nonce this exact sign-in attempt was
 * bound to — because an unverified ID token is a full account-takeover
 * primitive: anyone who can reach this endpoint could otherwise hand it any
 * email address and be signed in as that person.
 *
 * Implemented against `node:crypto` directly rather than a JWT library. Two
 * reasons: Google's ID tokens are RS256-signed JWTs and Node has supported
 * importing a JWK public key (`createPublicKey({ format: 'jwk' })`) and
 * one-shot RSA verification since well before this server's minimum Node
 * version, so a dependency buys nothing here; and this is exactly the kind
 * of code where fewer moving parts is a security property, not a style
 * preference — every additional package is another supply chain to trust
 * with "does this correctly refuse a forged signature".
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
// Google's own docs say the issuer claim may be either form; both are seen in
// the wild depending on token version.
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

type Jwk = { kty: string; kid: string; n: string; e: string; alg?: string; use?: string };
type Jwks = { keys: Jwk[] };

export class GoogleIdTokenError extends Error {}

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

/* ── JWKS fetching, with a swap point for tests ─────────────────────────── */

type JwksProvider = () => Promise<Jwks>;

async function defaultFetchJwks(): Promise<Jwks> {
  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new GoogleIdTokenError(`Could not fetch Google's signing keys (${response.status}).`);
  }
  return (await response.json()) as Jwks;
}

let jwksProvider: JwksProvider = defaultFetchJwks;
let cache: { fetchedAt: number; jwks: Jwks } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Test-only seam: inject a fixed key set instead of calling Google over the network. */
export function setJwksProviderForTesting(provider: JwksProvider | null): void {
  jwksProvider = provider ?? defaultFetchJwks;
  cache = null;
}

async function getJwks(forceFresh: boolean): Promise<Jwks> {
  if (!forceFresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.jwks;
  const jwks = await jwksProvider();
  cache = { fetchedAt: Date.now(), jwks };
  return jwks;
}

/* ── Verification ────────────────────────────────────────────────────────── */

function b64urlDecode(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

/**
 * Verify a Google ID token and return the identity it names.
 *
 * @param idToken the raw `id_token` JWT as returned from Google's token endpoint.
 * @param expectedAudience this server's configured `GOOGLE_CLIENT_ID`.
 * @param expectedNonce the nonce the web app bound to this sign-in attempt
 *   before redirecting to Google — checked here so a token minted for a
 *   DIFFERENT attempt (e.g. captured and replayed) is refused even though its
 *   signature, issuer, audience and expiry are all genuinely valid.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedAudience: string,
  expectedNonce: string,
): Promise<VerifiedGoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleIdTokenError('That is not a JWT.');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new GoogleIdTokenError('The token is not valid JSON.');
  }

  // One algorithm, accepted deliberately rather than read off the token: an
  // attacker who controls `alg` controls which check runs, and "none" or a
  // symmetric algorithm confused for an asymmetric one are exactly the two
  // decade-old JWT footguns this refuses to reopen.
  if (header.alg !== 'RS256') throw new GoogleIdTokenError('Unexpected signing algorithm.');
  if (!header.kid) throw new GoogleIdTokenError('The token names no signing key.');

  let jwks = await getJwks(false);
  let jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // The key may simply have rotated since the last fetch — refreshed once,
    // rather than failing every sign-in until the cache happens to expire.
    jwks = await getJwks(true);
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new GoogleIdTokenError("Signing key not found in Google's published set.");

  let verified: boolean;
  try {
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    verified = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      b64urlDecode(signatureB64),
    );
  } catch {
    throw new GoogleIdTokenError('Could not verify the signature.');
  }
  if (!verified) throw new GoogleIdTokenError('Signature verification failed.');

  const iss = payload.iss;
  if (typeof iss !== 'string' || !VALID_ISSUERS.has(iss)) {
    throw new GoogleIdTokenError('Unexpected issuer.');
  }

  if (payload.aud !== expectedAudience) throw new GoogleIdTokenError('Unexpected audience.');

  const exp = payload.exp;
  if (typeof exp !== 'number' || exp < Math.floor(Date.now() / 1000)) {
    throw new GoogleIdTokenError('This token has expired.');
  }

  // Bound to THIS sign-in attempt, not merely "a" valid Google token — the
  // property that makes a captured/replayed token from a different attempt
  // fail even though every other check above passes.
  if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
    throw new GoogleIdTokenError('This token was not issued for this sign-in attempt.');
  }

  const email = payload.email;
  const subject = payload.sub;
  if (typeof email !== 'string' || typeof subject !== 'string') {
    throw new GoogleIdTokenError('The token is missing required claims.');
  }
  // Google lets an account exist with an unverified email; signing someone in
  // under an address they have not proven they own is exactly the kind of
  // account-takeover primitive this whole module exists to close off.
  if (payload.email_verified !== true) {
    throw new GoogleIdTokenError('Google has not verified this email address.');
  }

  const displayName =
    typeof payload.name === 'string' && payload.name.trim() !== ''
      ? payload.name.trim()
      : email.split('@')[0]!;

  return { subject, email: email.toLowerCase(), displayName };
}
