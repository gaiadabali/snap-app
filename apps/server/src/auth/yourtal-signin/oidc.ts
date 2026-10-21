import { timingSafeEqual } from 'node:crypto';

import * as oidc from 'openid-client';

import { refusal } from './claims.js';
import {
  YOURTAL_SCOPES,
  webClientKey,
  yourtalClient,
  type YourTalClientKind,
  type YourTalClientSettings,
} from './settings.js';

/**
 * The protocol half of Sign in with YourTal, all in openid-client 6.x
 * (OpenID Certified). Nothing here is hand-written protocol: discovery, the
 * authorization URL, PKCE, the `iss` response parameter (RFC 9207), the code
 * redemption with `private_key_jwt` or as a public client, and the ID token
 * checks (`iss`, `aud`, `azp`, `nonce`, `exp`, `iat`) are the library's.
 * docs/26 §1.7.
 *
 * THE SIGNATURE. openid-client does NOT check an ID token's signature by
 * default when it comes straight from the token endpoint (OIDC Core
 * §3.1.3.7 lets a client rely on TLS there). We do not: `make()` turns on
 * `enableNonRepudiationChecks`, so every ID token is verified against
 * YourTal's published JWKS by `kid` (RS256 only), and a token signed with any
 * other key is refused. yourtal-signin.db.test.ts proves it with a provider
 * that publishes the wrong key.
 *
 * YourTal's tokens never leave this module except as the verified claims:
 * nothing is stored, logged or sent to the browser or the phone (§1.9, §1.10).
 */

/** Discovery is cacheable for an hour (docs/26 §1.8). The JWKS cache lives inside openid-client. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
/** No request to YourTal waits longer than this. */
const HTTP_TIMEOUT_SECONDS = 10;

type Cached = { at: number; issuer: string; clientId: string; config: Promise<oidc.Configuration> };
const configurations = new Map<YourTalClientKind, Cached>();

async function configurationFor(issuer: URL, client: YourTalClientSettings): Promise<oidc.Configuration> {
  const cached = configurations.get(client.kind);
  if (
    cached &&
    cached.issuer === issuer.href &&
    cached.clientId === client.clientId &&
    Date.now() - cached.at < DISCOVERY_TTL_MS
  ) {
    return cached.config;
  }

  const make = async (): Promise<oidc.Configuration> => {
    const auth =
      client.kind === 'web'
        ? oidc.PrivateKeyJwt(await webClientKey().then(({ key, kid }) => ({ key, kid })))
        : oidc.None();
    // Plain http only ever reaches here outside production (config.ts refuses
    // it there): a developer's machine, or the tests' stand-in provider.
    const insecure = issuer.protocol === 'http:';
    return oidc.discovery(
      issuer,
      client.clientId,
      {
        redirect_uris: [client.redirectUri],
        response_types: ['code'],
        // docs/26 §1.7: RS256 for ID tokens. Anything else is refused.
        id_token_signed_response_alg: 'RS256',
      },
      auth,
      {
        timeout: HTTP_TIMEOUT_SECONDS,
        // Order matters: the insecure-transport flag first, so the JWKS fetch
        // made by the signature check is allowed on a developer's http issuer.
        execute: [...(insecure ? [oidc.allowInsecureRequests] : []), oidc.enableNonRepudiationChecks],
      },
    );
  };

  const config = make();
  configurations.set(client.kind, { at: Date.now(), issuer: issuer.href, clientId: client.clientId, config });
  // A failed discovery is not cached: the next sign-in asks again.
  config.catch(() => {
    if (configurations.get(client.kind)?.config === config) configurations.delete(client.kind);
  });
  return config;
}

/** Tests only. */
export function resetYourTalDiscoveryCache(): void {
  configurations.clear();
}

function clientOrRefuse(kind: YourTalClientKind) {
  const found = yourtalClient(kind);
  if (!found) throw refusal('not_configured');
  return found;
}

/** Whether a client is configured, for `GET /v1/auth/yourtal`. */
export function isClientConfigured(kind: YourTalClientKind): boolean {
  return yourtalClient(kind) !== null;
}

export type StartedAuthorization = {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
};

/**
 * The authorization URL for a new sign-in, and the secrets the finish must
 * match. `state`, `nonce` and the PKCE verifier are 32 random bytes each
 * (openid-client's generators); only the S256 challenge goes in the URL.
 */
export async function startAuthorization(
  kind: YourTalClientKind,
  options: { signUp: boolean; locale: string },
): Promise<StartedAuthorization> {
  const { issuer, client } = clientOrRefuse(kind);
  let config: oidc.Configuration;
  try {
    config = await configurationFor(issuer, client);
  } catch {
    throw refusal('yourtal_unavailable');
  }

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const parameters: Record<string, string> = {
    redirect_uri: client.redirectUri,
    scope: YOURTAL_SCOPES,
    response_type: 'code',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    ui_locales: options.locale,
  };
  // OpenID Connect "Initiating User Registration": YourTal opens its sign-up
  // form instead of sign-in (docs/26 §1.7).
  if (options.signUp) parameters.prompt = 'create';

  return { url: oidc.buildAuthorizationUrl(config, parameters).href, state, nonce, codeVerifier };
}

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.byteLength === y.byteLength && timingSafeEqual(x, y);
}

/**
 * Redeem the code and return the ID token's claims, verified.
 *
 * `state` has already been compared by the caller against the stored flow.
 * `iss` is compared here, exactly, with the issuer YourTal's discovery
 * document names (RFC 9207; a mix-up defence) — the discovered string, not a
 * re-serialised URL, which would add a trailing slash to a bare-origin
 * issuer. openid-client then checks both again, with PKCE, the client
 * authentication and every ID token check including the signature. A wrong
 * `iss` is `invalid_flow`; any other failure is `yourtal_failed`.
 */
export async function redeemCode(
  kind: YourTalClientKind,
  response: { code: string; state: string; iss: string },
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<Record<string, unknown>> {
  const { issuer, client } = clientOrRefuse(kind);
  let config: oidc.Configuration;
  try {
    config = await configurationFor(issuer, client);
  } catch {
    throw refusal('yourtal_unavailable');
  }

  if (!same(response.iss, config.serverMetadata().issuer)) throw refusal('invalid_flow');

  // The authorization response exactly as YourTal sent it to the redirect URI.
  const currentUrl = new URL(client.redirectUri);
  currentUrl.searchParams.set('code', response.code);
  currentUrl.searchParams.set('state', response.state);
  currentUrl.searchParams.set('iss', response.iss);

  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
  try {
    // openid-client sends `redirect_uri` as this URL without its query: the
    // registered redirect URI, character for character.
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: expected.codeVerifier,
      expectedState: expected.state,
      expectedNonce: expected.nonce,
      idTokenExpected: true,
    });
  } catch (error) {
    // A network failure is YourTal being down; anything else (a used code, a
    // bad signature, a wrong nonce) is a refused sign-in. Neither carries the
    // library's message out: it can quote the response.
    if (error instanceof TypeError || (error as { name?: string })?.name === 'TimeoutError') {
      throw refusal('yourtal_unavailable');
    }
    throw refusal('yourtal_failed');
  }

  const claims = tokens.claims();
  if (!claims) throw refusal('yourtal_failed');
  // The access token and the ID token go out of scope here and are never kept.
  return { ...claims } as Record<string, unknown>;
}
