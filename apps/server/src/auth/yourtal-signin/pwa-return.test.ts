import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { refusalCode } from './claims.js';
import { startFakeYourTalOidc, type FakeYourTalOidc } from '../../test-support/fake-yourtal-oidc.js';

/**
 * The phone client in a browser (the PWA): `platform: 'web'` picks the PWA's
 * configured return page, the choice rides in the stored `state`, and the
 * token request names the same redirect. A real provider stands in for
 * YourTal; no database (the flow row is just `state`, `nonce`, verifier here).
 */
describe('Sign in with YourTal from the PWA', () => {
  let yt: FakeYourTalOidc;
  let oidc: typeof import('./oidc.js');
  let settings: typeof import('./settings.js');

  beforeAll(async () => {
    yt = await startFakeYourTalOidc();
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
    vi.stubEnv('TOKEN_SECRET', 'test-only-secret-at-least-32-characters-long');
    vi.stubEnv('WEB_PUBLIC_URL', 'https://snap-apps.example');
    vi.stubEnv('YOURTAL_OIDC_ISSUER', yt.issuer);
    vi.stubEnv('YOURTAL_OIDC_MOBILE_CLIENT_ID', yt.mobileClientId);
    vi.stubEnv('YOURTAL_OIDC_MOBILE_WEB_REDIRECT_URI', yt.mobileWebRedirectUri);
    vi.resetModules();
    oidc = await import('./oidc.js');
    settings = await import('./settings.js');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await yt?.close();
  });

  const person = () => ({
    accountId: randomUUID(),
    email: `pwa-${randomUUID()}@example.test`,
    name: 'PWA Person',
    region: 'AU',
    ageBand: 'adult',
  });

  /** start → sign in at the stand-in → the return URL, plus what the flow row would hold. */
  async function signInAtYourTal(platform?: 'native' | 'web') {
    const started = await oidc.startAuthorization('mobile', {
      signUp: false,
      locale: 'en-AU',
      ...(platform ? { platform } : {}),
    });
    yt.nextSignIn = { person: person() };
    const back = await yt.authorize(started.url);
    return { started, back, params: new URL(started.url).searchParams };
  }

  const responseOf = (back: URL) => ({
    code: back.searchParams.get('code')!,
    state: back.searchParams.get('state')!,
    iss: back.searchParams.get('iss')!,
  });

  it('reports the PWA as available only with its return page configured', () => {
    expect(oidc.isClientConfigured('mobile', 'web')).toBe(true);
    expect(oidc.isClientConfigured('mobile')).toBe(true);
  });

  it('platform web: authorizes with the PWA page, tags the state, and redeems with the same redirect', async () => {
    const { started, back, params } = await signInAtYourTal('web');
    expect(params.get('redirect_uri')).toBe(yt.mobileWebRedirectUri);
    expect(started.state.startsWith(settings.WEB_RETURN_STATE_PREFIX)).toBe(true);
    expect(`${back.origin}${back.pathname}`).toBe(yt.mobileWebRedirectUri);

    const claims = await oidc.redeemCode('mobile', responseOf(back), started);
    expect(claims.sub).toEqual(expect.any(String));
    expect(claims.region).toBe('AU');
  });

  it('native (the default, and every APK in the field): unchanged scheme redirect, untagged state', async () => {
    const { started, back, params } = await signInAtYourTal();
    expect(params.get('redirect_uri')).toBe(yt.mobileRedirectUri);
    expect(started.state.startsWith(settings.WEB_RETURN_STATE_PREFIX)).toBe(false);
    expect(back.href.startsWith(yt.mobileRedirectUri)).toBe(true);
    await expect(oidc.redeemCode('mobile', responseOf(back), started)).resolves.toMatchObject({ region: 'AU' });
  });

  it('a PWA code redeemed as a native flow is refused: the redirect is bound to the flow, not the caller', async () => {
    const { started, back } = await signInAtYourTal('web');
    const untagged = { ...started, state: started.state.slice(settings.WEB_RETURN_STATE_PREFIX.length) };
    const response = { ...responseOf(back), state: untagged.state };
    const error = await oidc.redeemCode('mobile', response, untagged).catch((e: unknown) => e);
    expect(refusalCode(error)).toBe('yourtal_failed');
  });

  it('the website client ignores platform', async () => {
    // No website client here, so it is simply not configured either way.
    expect(oidc.isClientConfigured('web', 'web')).toBe(false);
  });
});

describe('redirectUriFor and platformOfState', () => {
  it('picks only from the client settings', async () => {
    const { redirectUriFor, platformOfState, WEB_RETURN_STATE_PREFIX } = await import('./settings.js');
    const mobile = { kind: 'mobile' as const, clientId: 'm', redirectUri: 'au.com.snapapps.app:/oauth/yourtal' };
    expect(redirectUriFor(mobile, 'native')).toBe(mobile.redirectUri);
    expect(redirectUriFor(mobile, 'web')).toBeNull();
    const withPwa = { ...mobile, webRedirectUri: 'https://snapapp.app.gaiada.com/oauth/yourtal' };
    expect(redirectUriFor(withPwa, 'web')).toBe(withPwa.webRedirectUri);
    const web = { kind: 'web' as const, clientId: 'w', redirectUri: 'https://snapapp.gaiada.com/auth/yourtal/callback' };
    expect(redirectUriFor(web, 'web')).toBe(web.redirectUri);

    expect(platformOfState(`${WEB_RETURN_STATE_PREFIX}abc`)).toBe('web');
    expect(platformOfState('abc')).toBe('native');
    // base64url states never contain a dot, so an untagged state can never read as a PWA one.
    expect(platformOfState('pwa_abc')).toBe('native');
  });
});
