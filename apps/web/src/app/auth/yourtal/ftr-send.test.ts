import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/server')>();
  return { ...actual, api: (...a: unknown[]) => apiMock(...a) };
});
vi.mock('@/lib/panels/workspace', () => ({ loadWorkspace: async () => ({ workspace: { id: 'w1' } }) }));

const PUBLIC = 'https://snap-apps.example';
const FLOW = 'snap_yt_flow';
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('WEB_PUBLIC_URL', `${PUBLIC}/`);
  apiMock.mockReset();
});

const cb = (qs: string, cookies: string) =>
  new NextRequest(`http://0.0.0.0:3000/auth/yourtal/callback?${qs}`, { headers: { cookie: cookies } });
const SEND = `${FLOW}=f1; snap_ftr_send=f1`;
const where = (r: Response) => new URL(r.headers.get('location')!);
const cleared = (r: Response) => r.headers.getSetCookie().join(';');

describe('YourTal callback for a send', () => {
  it('finishes the send (not the sign-in), shows Sent and clears both cookies', async () => {
    apiMock.mockResolvedValue({ status: 'sent', importId: 'i', financialYear: '2025-26', lineCount: 3, returnTo: '/app/categories' });
    const { GET } = await import('./callback/route');
    const res = await GET(cb('code=c&state=s&iss=https://y', SEND));
    expect(apiMock).toHaveBeenCalledWith('/v1/ftr-sends/finish', expect.objectContaining({
      body: { flowId: 'f1', state: 's', code: 'c', iss: 'https://y' }, workspaceId: 'w1',
    }));
    expect(where(res).pathname).toBe('/app/categories');
    expect(where(res).searchParams.get('ftr')).toBe('sent');
    expect(where(res).searchParams.get('fy')).toBe('2025-26');
    expect(cleared(res)).toContain('snap_ftr_send=;');
    expect(cleared(res)).toContain(`${FLOW}=;`);
  });

  it('passes YourTal\'s error on (Cancel) and shows cancelled', async () => {
    apiMock.mockResolvedValue({ status: 'cancelled', returnTo: null });
    const { GET } = await import('./callback/route');
    const res = await GET(cb('error=access_denied&state=s', SEND));
    expect(apiMock.mock.calls[0]![1].body).toEqual({ flowId: 'f1', state: 's', error: 'access_denied' });
    expect(where(res).searchParams.get('ftr')).toBe('cancelled');
  });

  it('treats send_refused (Cancel at YourTal) as cancelled', async () => {
    const { ApiError } = await import('@/lib/api/server');
    apiMock.mockRejectedValue(new ApiError(409, 'x', { error: 'send_refused' }));
    const { GET } = await import('./callback/route');
    const res = await GET(cb('error=send_refused&state=s', SEND));
    expect(where(res).searchParams.get('ftr')).toBe('cancelled');
  });

  it('shows failed with the API error code, never its text', async () => {
    const { ApiError } = await import('@/lib/api/server');
    apiMock.mockRejectedValue(new ApiError(503, 'raw upstream text', { error: 'ftr_unavailable' }));
    const { GET } = await import('./callback/route');
    const res = await GET(cb('code=c&state=s&iss=i', SEND));
    expect(where(res).searchParams.get('ftr')).toBe('failed');
    expect(where(res).searchParams.get('code')).toBe('ftr_unavailable');
    expect(res.headers.get('location')).not.toContain('raw');
  });

  it('a marker that names another flow leaves the sign-in callback alone', async () => {
    apiMock.mockRejectedValue(new Error('x'));
    const { GET } = await import('./callback/route');
    await GET(cb('code=c&state=s&iss=i', `${FLOW}=f2; snap_ftr_send=f1`));
    expect(apiMock.mock.calls[0]![0]).toBe('/v1/auth/yourtal/finish');
  });

  it('without the marker cookie it stays the sign-in callback', async () => {
    apiMock.mockRejectedValue(new Error('x'));
    const { GET } = await import('./callback/route');
    await GET(cb('code=c&state=s&iss=i', `${FLOW}=f1`));
    expect(apiMock.mock.calls[0]![0]).toBe('/v1/auth/yourtal/finish');
  });
});

describe('POST /app/ftr-send', () => {
  const post = (headers: Record<string, string> = {}) =>
    new NextRequest('http://0.0.0.0:3000/app/ftr-send', {
      method: 'POST',
      headers: { host: 'snap-apps.example', 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ financialYear: '2025-26' }),
    });

  it('sets the flow cookie and the marker and answers the URL', async () => {
    apiMock.mockResolvedValue({ url: 'https://yourtal/auth?transfer=t', flowId: 'f9', sendId: 's', expiresAt: '' });
    const { POST } = await import('../../app/(individual)/ftr-send/route');
    const res = await POST(post({ origin: 'https://snap-apps.example' }));
    expect(await res.json()).toEqual({ url: 'https://yourtal/auth?transfer=t' });
    const c = res.headers.getSetCookie().join(';');
    expect(c).toContain(`${FLOW}=f9`);
    expect(c).toContain('snap_ftr_send=f9');
    expect(c).toContain('Path=/auth/yourtal');
  });

  it('refuses a cross-site post before calling the API', async () => {
    const { POST } = await import('../../app/(individual)/ftr-send/route');
    const res = await POST(post({ origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('refuses Sec-Fetch-Site cross-site with no Origin, and Origin: null', async () => {
    const { POST } = await import('../../app/(individual)/ftr-send/route');
    expect((await POST(post({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await POST(post({ origin: 'null' }))).status).toBe(403);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('answers an API refusal with a fixed message and no cookie', async () => {
    const { ApiError } = await import('@/lib/api/server');
    apiMock.mockRejectedValue(new ApiError(403, 'raw', { error: 'teen_space' }));
    const { POST } = await import('../../app/(individual)/ftr-send/route');
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain('Nothing was sent.');
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
