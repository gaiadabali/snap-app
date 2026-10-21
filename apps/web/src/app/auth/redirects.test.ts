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

  it('sends a failure to /sign-in?error= on the public host', async () => {
    apiMock.mockRejectedValue(new Error('nope'));
    const { GET } = await import('./magic/callback/route');
    const res = await GET(req('/auth/magic/callback?token=bogus'));
    expect(res.headers.get('location')?.startsWith(`${PUBLIC}/sign-in?error=`)).toBe(true);
  });
});

describe('google routes redirects', () => {
  it('callback failure goes to /sign-in?error= on the public host', async () => {
    const { GET } = await import('./google/callback/route');
    const res = await GET(req('/auth/google/callback?error=access_denied'));
    expect(res.headers.get('location')?.startsWith(`${PUBLIC}/sign-in?error=`)).toBe(true);
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
