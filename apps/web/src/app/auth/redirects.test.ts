import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behind the reverse proxy `request.url` is the Next server's bind address
 * (http://0.0.0.0:3000). Every redirect a route handler builds must use the
 * public origin from WEB_PUBLIC_URL instead.
 */
const apiMock = vi.fn();

vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return { ...actual, endServerSession: vi.fn(async () => undefined) };
});

const PUBLIC = 'https://snap-apps.example';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('WEB_PUBLIC_URL', `${PUBLIC}/`);
  apiMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://0.0.0.0:3000${path}`, init);
}

const user = { id: 'u1', email: 'a@b.co' };

/** The `error` query value of a redirect: it must always be a known code, never text. */
function errorOf(res: Response): string | null {
  return new URL(res.headers.get('location')!).searchParams.get('error');
}

let ApiErrorCtor: typeof import('@/lib/api/server').ApiError;
beforeEach(async () => {
  ApiErrorCtor = (await import('@/lib/api/server')).ApiError;
});

describe('magic-link callback redirects', () => {
  it('sends a user with no workspaces to /onboarding on the public host', async () => {
    apiMock.mockResolvedValue({ token: 't', user, workspaces: [] });
    const { GET } = await import('./magic/callback/route');
    const res = await GET(req('/auth/magic/callback?token=abc'));
    expect(res.headers.get('location')).toBe(`${PUBLIC}/onboarding`);
  });

  it('sends a user with workspaces to returnTo on the public host', async () => {
    apiMock.mockResolvedValue({
      token: 't',
      user,
      workspaces: [{ id: 'w1', name: 'W', kind: 'individual', role: 'owner' }],
    });
    const { GET } = await import('./magic/callback/route');
    const res = await GET(req('/auth/magic/callback?token=abc&returnTo=/app/points'));
    expect(res.headers.get('location')).toBe(`${PUBLIC}/app/points`);
  });

  it('sends a failure to /sign-in?error=<code> on the public host', async () => {
    apiMock.mockRejectedValue(new Error('nope'));
    const { GET } = await import('./magic/callback/route');
    const res = await GET(req('/auth/magic/callback?token=bogus'));
    expect(res.headers.get('location')?.startsWith(`${PUBLIC}/sign-in?error=`)).toBe(true);
    expect(errorOf(res)).toBe('link_invalid');
  });

  it('never carries the server message, only a known code', async () => {
    apiMock.mockRejectedValue(
      new ApiErrorCtor(401, 'Call +61 400 now', { error: 'rate_limited', message: 'Call +61 400 now' }),
    );
    const { GET } = await import('./magic/callback/route');
    const res = await GET(req('/auth/magic/callback?token=bogus'));
    expect(errorOf(res)).toBe('rate_limited');
    expect(res.headers.get('location')).not.toContain('400');
  });

  it('a missing token is link_invalid', async () => {
    const { GET } = await import('./magic/callback/route');
    expect(errorOf(await GET(req('/auth/magic/callback')))).toBe('link_invalid');
  });
});

describe('google routes redirects', () => {
  it('callback failure goes to /sign-in?error= on the public host', async () => {
    const { GET } = await import('./google/callback/route');
    const res = await GET(req('/auth/google/callback?error=access_denied'));
    expect(res.headers.get('location')?.startsWith(`${PUBLIC}/sign-in?error=`)).toBe(true);
    expect(errorOf(res)).toBe('google_cancelled');
  });

  it('callback passes a known server code, otherwise a generic one', async () => {
    vi.doMock('@/lib/auth/google', () => ({ exchangeGoogleCode: async () => 'id-token' }));
    vi.doMock('@/lib/auth/oauth-state', () => ({
      OAUTH_COOKIE_NAME: 'oauth',
      unpackOAuthState: () => ({ returnTo: '/app', codeVerifier: 'v', nonce: 'n' }),
      verifyState: () => true,
    }));
    const { GET } = await import('./google/callback/route');
    const { ApiError } = await import('@/lib/api/server');
    apiMock.mockRejectedValueOnce(
      new ApiError(403, 'Evil text', { error: 'region_not_supported', message: 'Evil text' }),
    );
    expect(errorOf(await GET(req('/auth/google/callback?code=c&state=s')))).toBe('region_not_supported');
    apiMock.mockRejectedValueOnce(new ApiError(500, 'Evil text', { error: 'Evil text' }));
    expect(errorOf(await GET(req('/auth/google/callback?code=c&state=s')))).toBe('google_failed');
    vi.doUnmock('@/lib/auth/google');
    vi.doUnmock('@/lib/auth/oauth-state');
  });

  it('start route misconfiguration redirects to /sign-in on the public host', async () => {
    vi.doMock('@/lib/auth/google', () => ({
      buildGoogleAuthorizeUrl: () => {
        throw new Error('not configured');
      },
    }));
    const { GET } = await import('./google/route');
    const res = await GET(req('/auth/google'));
    expect(res.headers.get('location')?.startsWith(`${PUBLIC}/sign-in?error=`)).toBe(true);
    expect(errorOf(res)).toBe('google_not_configured');
    vi.doUnmock('@/lib/auth/google');
  });
});

describe('sign-out redirect', () => {
  it('lands on /sign-in on the public host', async () => {
    const { POST } = await import('./sign-out/route');
    const res = await POST(req('/auth/sign-out', { method: 'POST' }));
    expect(res.headers.get('location')).toBe(`${PUBLIC}/sign-in`);
  });
});

describe('YourTal start route', () => {
  it('passes a known server code through', async () => {
    apiMock.mockRejectedValue(
      new ApiErrorCtor(403, 'Evil text', { error: 'region_not_supported', message: 'Evil text' }),
    );
    const { GET } = await import('./yourtal/route');
    const res = await GET(req('/auth/yourtal'));
    expect(res.headers.get('location')?.startsWith(`${PUBLIC}/sign-in?error=region_not_supported`)).toBe(true);
  });

  it('uses yourtal_unavailable for an unknown code or an unreachable server, on /register for sign-up', async () => {
    apiMock.mockRejectedValueOnce(new ApiErrorCtor(500, 'Evil text', { error: 'Evil text' }));
    const { GET } = await import('./yourtal/route');
    const a = await GET(req('/auth/yourtal?signUp=1'));
    expect(a.headers.get('location')?.startsWith(`${PUBLIC}/register?error=yourtal_unavailable`)).toBe(true);
    apiMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(errorOf(await GET(req('/auth/yourtal')))).toBe('yourtal_unavailable');
  });
});

describe('YourTal callback route', () => {
  const cb = (query: string) =>
    req(`/auth/yourtal/callback?${query}`, { headers: { cookie: 'snap_yt_flow=flow1' } });
  const signIn = (code: string) => `${PUBLIC}/sign-in?error=${code}`;

  it.each([
    ['user_cancelled', 'yourtal_cancelled'],
    ['teen_not_allowed', 'teen_invite_required'],
    ['teen_invite_required', 'teen_invite_required'],
    ['region_not_supported', 'region_not_supported'],
    ['account_on_hold', 'account_on_hold'],
    ['Your account is locked, call +61 400', 'yourtal_cancelled'],
  ])('access_denied / %s redirects with code %s', async (description, code) => {
    const { GET } = await import('./yourtal/callback/route');
    const res = await GET(cb(`error=access_denied&error_description=${encodeURIComponent(description)}`));
    expect(res.headers.get('location')).toBe(signIn(code));
  });

  it('any other provider error is yourtal_failed, whatever the text', async () => {
    const { GET } = await import('./yourtal/callback/route');
    const res = await GET(cb('error=Call%20400&error_description=Call%20400'));
    expect(res.headers.get('location')).toBe(signIn('yourtal_failed'));
  });

  it('a callback missing its pieces is link_invalid', async () => {
    const { GET } = await import('./yourtal/callback/route');
    const res = await GET(cb('code=c'));
    expect(res.headers.get('location')).toBe(signIn('link_invalid'));
  });

  it.each([
    'teen_invite_required',
    'region_not_supported',
    'email_unverified',
    'staff_strong_auth_required',
    'staff_reauth_required',
    'account_review',
    'try_again',
    'rate_limited',
    'invalid_flow',
    'yourtal_unavailable',
    'yourtal_failed',
  ])('the server refusal %s is passed as that code, not its text', async (code) => {
    apiMock.mockRejectedValue(
      new ApiErrorCtor(403, 'YourTal-worded text', { error: code, message: 'YourTal-worded text' }),
    );
    const { GET } = await import('./yourtal/callback/route');
    const res = await GET(cb('code=c&state=s&iss=https%3A%2F%2Fyt.test'));
    expect(res.headers.get('location')).toBe(signIn(code));
  });

  it('an unknown server code or non-API failure is the generic yourtal_failed', async () => {
    const { GET } = await import('./yourtal/callback/route');
    apiMock.mockRejectedValueOnce(new ApiErrorCtor(500, 'Evil', { error: 'Evil', message: 'Evil' }));
    expect((await GET(cb('code=c&state=s&iss=i'))).headers.get('location')).toBe(signIn('yourtal_failed'));
    apiMock.mockRejectedValueOnce(new Error('boom'));
    expect((await GET(cb('code=c&state=s&iss=i'))).headers.get('location')).toBe(signIn('yourtal_failed'));
  });
});
