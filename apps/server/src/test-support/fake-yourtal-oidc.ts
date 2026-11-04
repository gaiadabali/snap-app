import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from 'jose';
import Provider, { interactionPolicy } from 'oidc-provider';

/**
 * A stand-in YourTal OpenID provider, in-process, for tests (group task 3.3).
 *
 * It is the REAL library YourTal mounts (`oidc-provider` 9.x, docs/26 §1.1),
 * configured the way docs/26 says YourTal's is, so the client code under test
 * meets the same protocol it will meet on staging:
 *
 *   - issuer with a path (`<origin>/oidc`), discovery under it;
 *   - `code` only, PKCE S256 REQUIRED for every client, the `iss` response
 *     parameter (RFC 9207), RS256 ID tokens with a `kid`;
 *   - pairwise subjects, one sector for both SnapApp clients, so the website
 *     and the phone app see the same `sub`;
 *   - `conformIdTokenClaims: false`: the ID token carries the granted claims
 *     (`email`, `email_verified`, `name`, `region`, `age_band`) and `amr`;
 *   - the website client authenticates with `private_key_jwt` (its public
 *     key registered here), the phone app is public (`none`);
 *   - `prompt=create` is requestable; dev interactions are OFF.
 *
 * The sign-in screen is replaced by `nextSignIn`: whoever a test puts there
 * "signs in" at the next interaction, with the `amr` it says — or cancels with
 * an `access_denied` reason. `authorize(url)` follows the authorization URL
 * like a browser (cookies, redirects) and returns the redirect to the app.
 * Unlike YourTal, it does NOT refuse teens or other regions itself: it hands
 * them to the app, so the tests can prove the app's own re-check. With
 * `enforceTeenInvites` it runs YourTal's check 4 for teens (docs/26 §3.3):
 * a `teen_invite` code made by the teen's guardian, or a standing accepted
 * invite, else `access_denied` / `teen_invite_required`.
 *
 * It also serves the teen invite API (`/api/oidc-clients/teen-invites`) for
 * the server client, behind a client-credentials token with `teen_invites`.
 */

export type FakePerson = {
  /** YourTal's internal user id. Never leaves the provider; the app sees the pairwise `sub`. */
  accountId: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  region?: string;
  ageBand?: string;
  /** A teen's approved guardian (their `accountId`): the only parent whose invite works. */
  guardianAccountId?: string;
};

export type FakeTeenInvite = {
  inviteId: string;
  code: string;
  parentSub: string;
  status: 'pending' | 'accepted' | 'expired' | 'ended';
  teenSub: string | null;
  expiresAt: string;
};

export type NextSignIn =
  | {
      person: FakePerson;
      amr?: string[];
      /** When the person signed in at YourTal (epoch seconds): the ID token's `auth_time`. Now when omitted. */
      authTime?: number;
    }
  | { cancel: string };

export type FakeYourTalOidc = {
  /** `http://127.0.0.1:<port>/oidc` */
  issuer: string;
  webClientId: string;
  mobileClientId: string;
  webRedirectUri: string;
  mobileRedirectUri: string;
  /** The website client's PRIVATE JWK, for the app's key file. */
  webPrivateJwk: JWK;
  /** Set before each `authorize`. Edit a person's fields to simulate a change at YourTal. */
  nextSignIn: NextSignIn | null;
  /** The parameters of the last authorization request YourTal received. */
  lastAuthorizationParams: URLSearchParams | null;
  /**
   * When true, the published JWKS holds a DIFFERENT public key under the same
   * `kid` as the one that signs ID tokens: every signature check must fail.
   */
  publishWrongJwks: boolean;
  /** Every refusal at the token endpoint, as the provider describes it ("client mismatch", ...). */
  grantErrors: string[];
  /** The `aud` of the Security Event Tokens it sends SnapApp's server (docs/29 §4.1). */
  serverClientId: string;
  /**
   * Signs a Security Event Token as YourTal's sender does (docs/29 §4.1):
   * header `{typ: secevent+jwt, alg: RS256, kid}` with the provider's OWN
   * signing key. `header` overrides header fields (a wrong `typ` or `kid`);
   * `impostor` signs with a different key under the same `kid`.
   */
  signSet(payload: JWTPayload, options?: { header?: Record<string, unknown>; impostor?: boolean }): Promise<string>;
  /** The `sub` this provider gives an account (pairwise, same for both clients). */
  subFor(accountId: string): string;
  /** Run check 4 for teens, as YourTal does. Off by default (see the header). */
  enforceTeenInvites: boolean;
  /** Every invite made through the invite API, by id. */
  teenInvites: Map<string, FakeTeenInvite>;
  /** Invites a parent may make before 429 (YourTal: 10 a day). */
  teenInviteLimit: number;
  /** Every invite API call, `METHOD path`. */
  teenInviteCalls: string[];
  /** Answer the next create as YourTal answers a replay: 201 with no `code`. */
  replayNextCreate: boolean;
  /** The invite API answers 503 to everything (YourTal down). */
  inviteApiDown: boolean;
  /** Follow an authorization URL like a browser; returns the URL YourTal redirected to. */
  authorize(url: string): Promise<URL>;
  close(): Promise<void>;
};

const SECTOR = 'snapapp-test';

export async function startFakeYourTalOidc(): Promise<FakeYourTalOidc> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const issuer = `http://127.0.0.1:${port}/oidc`;

  const signing = await generateKeyPair('RS256', { extractable: true });
  const providerJwk = { ...(await exportJWK(signing.privateKey)), kid: 'test-2026-10-a', alg: 'RS256', use: 'sig' };

  const impostor = await generateKeyPair('RS256', { extractable: true });
  const impostorJwks = JSON.stringify({
    keys: [{ ...(await exportJWK(impostor.publicKey)), kid: providerJwk.kid, alg: 'RS256', use: 'sig' }],
  });

  const web = await generateKeyPair('RS256', { extractable: true });
  const webPrivateJwk: JWK = { ...(await exportJWK(web.privateKey)), kid: 'snapapp-test-web-1', alg: 'RS256' };
  const webPublicJwk: JWK = { ...(await exportJWK(web.publicKey)), kid: 'snapapp-test-web-1', alg: 'RS256', use: 'sig' };

  const people = new Map<string, FakePerson>();
  const subFor = (accountId: string) =>
    createHash('sha256').update(`${SECTOR}:${accountId}`).digest('base64url').slice(0, 22);

  const policy = interactionPolicy.base();
  // OpenID Connect "Initiating User Registration" (docs/26 §1.7).
  policy.add(new interactionPolicy.Prompt({ name: 'create', requestable: true }), 0);

  const fake: FakeYourTalOidc = {
    issuer,
    webClientId: 'snapapp-test-web',
    mobileClientId: 'snapapp-test-mobile',
    webRedirectUri: 'https://snap-apps.test/auth/yourtal/callback',
    mobileRedirectUri: 'au.com.snapapps.app:/oauth/yourtal',
    webPrivateJwk,
    nextSignIn: null,
    lastAuthorizationParams: null,
    publishWrongJwks: false,
    grantErrors: [],
    serverClientId: 'snapapp-test-server',
    enforceTeenInvites: false,
    teenInvites: new Map(),
    teenInviteLimit: 10,
    teenInviteCalls: [],
    replayNextCreate: false,
    inviteApiDown: false,
    signSet: (payload, options = {}) =>
      new SignJWT(payload)
        .setProtectedHeader({ typ: 'secevent+jwt', alg: 'RS256', kid: providerJwk.kid, ...options.header } as never)
        .sign(options.impostor ? impostor.privateKey : signing.privateKey),
    subFor,
    authorize: (url) => followAsBrowser(url, fake),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };

  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: fake.webClientId,
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [webPublicJwk as never] },
        redirect_uris: [fake.webRedirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        id_token_signed_response_alg: 'RS256',
        subject_type: 'pairwise',
      },
      {
        client_id: fake.mobileClientId,
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        redirect_uris: [fake.mobileRedirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        id_token_signed_response_alg: 'RS256',
        subject_type: 'pairwise',
      },
      {
        // SnapApp's server: client credentials for the invite API, with the
        // website's key (one public key registered for both, as on staging).
        client_id: fake.serverClientId,
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [webPublicJwk as never] },
        redirect_uris: [],
        grant_types: ['client_credentials'],
        response_types: [],
        scope: 'teen_invites',
        subject_type: 'public',
      },
    ],
    jwks: { keys: [providerJwk as never] },
    responseTypes: ['code'],
    pkce: { required: () => true },
    subjectTypes: ['public', 'pairwise'],
    extraParams: ['teen_invite'],
    pairwiseIdentifier: async (_ctx, accountId) => subFor(accountId),
    clientAuthMethods: ['private_key_jwt', 'none'],
    scopes: ['openid', 'email', 'profile', 'account', 'teen_invites'],
    claims: {
      // `amr` and `auth_time` only reach the ID token when a requested scope
      // maps to them: the library masks everything else out. docs/26 §1.3
      // promises both, so YourTal's provider needs this same mapping, or no
      // staff member can ever sign in to SnapApp.
      openid: ['sub', 'auth_time', 'amr'],
      email: ['email', 'email_verified'],
      profile: ['name'],
      account: ['region', 'age_band'],
    },
    conformIdTokenClaims: false,
    ttl: { AuthorizationCode: 60, IdToken: 300, AccessToken: 600, Interaction: 3600, Session: 3600, Grant: 3600 },
    cookies: { keys: ['fake-yourtal-cookie-key-not-a-secret'] },
    features: { devInteractions: { enabled: false }, clientCredentials: { enabled: true } },
    interactions: { policy, url: (_ctx, interaction) => `/oidc/interaction/${interaction.uid}` },
    findAccount: async (_ctx, accountId) => {
      const person = people.get(accountId);
      if (!person) return undefined;
      return {
        accountId,
        claims: async () => {
          const claims: Record<string, unknown> = {
            sub: accountId,
            email: person.email,
            email_verified: person.emailVerified ?? true,
          };
          if (person.name !== undefined) claims.name = person.name;
          if (person.region !== undefined) claims.region = person.region;
          if (person.ageBand !== undefined) claims.age_band = person.ageBand;
          return claims as { sub: string };
        },
      };
    },
  });
  // The tests run on plain http; the app talks to it as an insecure issuer.
  provider.proxy = false;
  provider.on('grant.error', (_ctx: unknown, error: { error_detail?: string; error_description?: string }) => {
    fake.grantErrors.push(error.error_detail ?? error.error_description ?? 'unknown');
  });

  const callback = provider.callback();

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = req.url ?? '/';
      if (url.startsWith('/oidc/interaction/')) return interaction(req, res);
      if (url.startsWith('/api/oidc-clients/teen-invites')) return inviteApi(req, res, url);
      if (!url.startsWith('/oidc')) {
        res.statusCode = 404;
        return res.end();
      }
      if (fake.publishWrongJwks && url.split('?')[0] === '/oidc/jwks') {
        res.setHeader('content-type', 'application/jwk-set+json');
        return res.end(impostorJwks);
      }
      if (url.startsWith('/oidc/auth?')) {
        fake.lastAuthorizationParams = new URL(url, issuer).searchParams;
      }
      // Mounted under /oidc, as YourTal mounts it (docs/26 §1.1).
      (req as IncomingMessage & { originalUrl?: string }).originalUrl = url;
      req.url = url.slice('/oidc'.length) || '/';
      return callback(req, res);
    })().catch((error: unknown) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });

  // The "sign-in and consent screen".
  async function interaction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const details = await provider.interactionDetails(req, res);
    const next = fake.nextSignIn;
    if (!next) {
      await provider.interactionFinished(req, res, { error: 'access_denied', error_description: 'user_cancelled' });
      return;
    }
    if ('cancel' in next) {
      await provider.interactionFinished(req, res, { error: 'access_denied', error_description: next.cancel });
      return;
    }
    const { person, amr = ['pwd'], authTime } = next;
    if (fake.enforceTeenInvites && person.ageBand === 'teen') {
      const refused = checkTeen(person, details.params.teen_invite);
      if (refused) {
        await provider.interactionFinished(req, res, { error: 'access_denied', error_description: refused });
        return;
      }
    }
    people.set(person.accountId, person);
    const grant = new provider.Grant({ accountId: person.accountId, clientId: String(details.params.client_id) });
    grant.addOIDCScope(String(details.params.scope));
    const grantId = await grant.save();
    await provider.interactionFinished(
      req,
      res,
      {
        login: { accountId: person.accountId, amr, ...(authTime === undefined ? {} : { ts: authTime }) },
        consent: { grantId },
        create: {},
      },
      { mergeWithLastSubmission: false },
    );
  }

  /** YourTal's check 4 for a teen at SnapApp: null to let them through. Accepts a pending invite as it goes. */
  function checkTeen(person: FakePerson, code: unknown): string | null {
    const teenSub = subFor(person.accountId);
    const guardianSub = person.guardianAccountId ? subFor(person.guardianAccountId) : null;
    const all = [...fake.teenInvites.values()];
    if (typeof code === 'string' && code) {
      const invite = all.find((i) => i.code === code);
      if (!invite || invite.status !== 'pending' || Date.parse(invite.expiresAt) < Date.now()) return 'teen_invite_required';
      if (invite.parentSub !== guardianSub) return 'teen_invite_required';
      invite.status = 'accepted';
      invite.teenSub = teenSub;
      return null;
    }
    return all.some((i) => i.status === 'accepted' && i.teenSub === teenSub) ? null : 'teen_invite_required';
  }

  const replays = new Map<string, Record<string, unknown>>();

  async function inviteApi(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
    const send = (status: number, body: Record<string, unknown>) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    fake.teenInviteCalls.push(`${req.method} ${url}`);
    if (fake.inviteApiDown) return send(503, { code: 'unavailable' });
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const token = bearer ? await provider.ClientCredentials.find(bearer) : undefined;
    if (!token || token.clientId !== fake.serverClientId) return send(401, { code: 'invalid_token' });
    if (!String(token.scope ?? '').split(' ').includes('teen_invites')) return send(403, { code: 'insufficient_scope' });

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
    const path = url.slice('/api/oidc-clients/teen-invites'.length).split('?')[0]!;
    const key = req.headers['idempotency-key'];

    if (req.method === 'POST' && path === '') {
      if (typeof key !== 'string') return send(400, { code: 'idempotency_key_required' });
      const replay = replays.get(key);
      if (replay) return send(201, replay); // the code is never stored, so a replay has none
      const replayNow = fake.replayNextCreate;
      fake.replayNextCreate = false;
      const parentSub = body.parentSub;
      const parent = [...people.values()].find((p) => subFor(p.accountId) === parentSub);
      if (!parent || (parent.ageBand ?? 'adult') !== 'adult') return send(403, { code: 'parent_not_eligible' });
      const made = [...fake.teenInvites.values()].filter((i) => i.parentSub === parentSub).length;
      if (made >= fake.teenInviteLimit) return send(429, { code: 'too_many_invites' });
      const invite: FakeTeenInvite = {
        inviteId: randomUUID(),
        code: randomBytes(16).toString('base64url'),
        parentSub: parentSub as string,
        status: 'pending',
        teenSub: null,
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      };
      fake.teenInvites.set(invite.inviteId, invite);
      replays.set(key, { inviteId: invite.inviteId, expiresAt: invite.expiresAt });
      if (replayNow) return send(201, replays.get(key)!);
      return send(201, { inviteId: invite.inviteId, code: invite.code, expiresAt: invite.expiresAt });
    }

    const match = /^\/([0-9a-f-]{36})(\/end)?$/.exec(path);
    const invite = match ? fake.teenInvites.get(match[1]!) : undefined;
    if (!invite) return send(404, { code: 'invite_not_found' });
    if (req.method === 'GET' && !match![2]) {
      return send(200, { inviteId: invite.inviteId, status: invite.status, teenSub: invite.teenSub });
    }
    if (req.method === 'POST' && match![2]) {
      if (body.parentSub !== invite.parentSub) return send(404, { code: 'invite_not_found' });
      invite.status = 'ended';
      return send(200, {});
    }
    return send(405, {});
  }

  return fake;
}

/**
 * A browser, minimally: follows redirects inside the provider, carrying its
 * cookies, until the provider redirects to one of the app's redirect URIs.
 * A fresh cookie jar per call, so one test's YourTal session never signs the
 * next test in.
 */
async function followAsBrowser(start: string, fake: FakeYourTalOidc): Promise<URL> {
  const jar = new Map<string, string>();
  let url = new URL(start);
  for (let hop = 0; hop < 15; hop += 1) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (/expires=Thu, 01 Jan 1970/i.test(line) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    const location = res.headers.get('location');
    if (!location) {
      throw new Error(`fake YourTal answered ${res.status} with no redirect: ${(await res.text()).slice(0, 300)}`);
    }
    if (location.startsWith(fake.webRedirectUri) || location.startsWith(fake.mobileRedirectUri)) {
      return new URL(location);
    }
    url = new URL(location, url);
  }
  throw new Error('fake YourTal: too many redirects');
}
