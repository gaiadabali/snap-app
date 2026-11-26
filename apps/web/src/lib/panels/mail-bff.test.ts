import { beforeEach, describe, expect, it, vi } from 'vitest';

// The BFF is the only code between the browser and SnapApp's `/v1/mail/*`, so what it
// refuses, what it forwards and what it never lets through is tested here with `api()`
// replaced by a spy. (`ApiError` is re-created because the real module is `server-only`
// and reads cookies.)
const state = vi.hoisted(() => ({
  impersonating: false,
  api: vi.fn(),
}));

vi.mock('@/lib/api/server', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly body?: unknown,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: state.api,
    getImpersonation: async () => (state.impersonating ? { token: 't', tenantId: 'x' } : null),
    newIdempotencyKey: () => 'idem-1',
  };
});

import { ApiError } from '@/lib/api/server';
import { isMailSession, mailForward, messageFor, readJsonObject, upstreamCode } from './mail-bff';

const own = (init: RequestInit = {}) => new Request('http://localhost:3000/api/mail/x', init);

beforeEach(() => {
  state.impersonating = false;
  state.api.mockReset();
});

describe('mailForward', () => {
  it('forwards a write with an idempotency key and answers no-store JSON', async () => {
    state.api.mockResolvedValue({ address: 'a@b.co' });
    const res = await mailForward(own({ method: 'POST' }), { method: 'POST', path: '/v1/mail/enable' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ address: 'a@b.co' });
    expect(state.api).toHaveBeenCalledWith('/v1/mail/enable', { method: 'POST', idempotencyKey: 'idem-1' });
  });

  it('sends no idempotency key on a read', async () => {
    state.api.mockResolvedValue({ items: [] });
    await mailForward(own(), { method: 'GET', path: '/v1/mail/app-passwords' });
    expect(state.api).toHaveBeenCalledWith('/v1/mail/app-passwords', { method: 'GET', idempotencyKey: undefined });
  });

  it('refuses a cross-site request before calling the API', async () => {
    const res = await mailForward(
      own({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }),
      { method: 'POST', path: '/v1/mail/session' },
    );
    expect(res.status).toBe(403);
    expect(state.api).not.toHaveBeenCalled();
  });

  it('refuses everything while staff is impersonating, so a mail token cannot be minted for the subject', async () => {
    state.impersonating = true;
    const res = await mailForward(own({ method: 'POST' }), { method: 'POST', path: '/v1/mail/session' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('impersonating');
    expect(state.api).not.toHaveBeenCalled();
  });

  it('passes the upstream status and code through, and words it itself', async () => {
    state.api.mockRejectedValue(new ApiError(409, 'raw upstream text', { error: 'yourtal_not_linked', message: 'raw upstream text' }));
    const res = await mailForward(own(), { method: 'GET', path: '/v1/mail/status' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('yourtal_not_linked');
    expect(body.message).toBe(messageFor('yourtal_not_linked'));
    expect(JSON.stringify(body)).not.toContain('raw upstream text');
  });

  it('turns a network failure into 502, never a stack', async () => {
    state.api.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:4000'));
    const res = await mailForward(own(), { method: 'GET', path: '/v1/mail/status' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5');
  });

  it('refuses an upstream success whose shape is not the expected one', async () => {
    state.api.mockResolvedValue({ unexpected: true });
    const res = await mailForward(own({ method: 'POST' }), {
      method: 'POST',
      path: '/v1/mail/session',
      accept: (d) => isMailSession(d),
    });
    expect(res.status).toBe(502);
  });

  it('answers 204 with no body for a delete', async () => {
    state.api.mockResolvedValue(undefined);
    const res = await mailForward(own({ method: 'DELETE' }), { method: 'DELETE', path: '/v1/mail/app-passwords/ap1' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('uses the success status the caller names for a body-carrying create', async () => {
    state.api.mockResolvedValue({ secret: 's' });
    const res = await mailForward(own({ method: 'POST' }), { method: 'POST', path: '/v1/mail/app-passwords', successStatus: 201 });
    expect(res.status).toBe(201);
  });
});

describe('upstreamCode', () => {
  it('reads code or error, and only a safe snake_case value', () => {
    expect(upstreamCode({ code: 'not_allowed' })).toBe('not_allowed');
    expect(upstreamCode({ error: 'yourtal_not_linked' })).toBe('yourtal_not_linked');
    expect(upstreamCode({ error: 'Not Allowed!' })).toBe('error');
    expect(upstreamCode({ error: '<script>' })).toBe('error');
    expect(upstreamCode('text')).toBe('error');
    expect(upstreamCode(undefined)).toBe('error');
  });
});

describe('readJsonObject', () => {
  it('reads an object, treats an empty body as {}, and refuses the rest', async () => {
    expect(await readJsonObject(own({ method: 'POST', body: '{"a":1}' }))).toEqual({ a: 1 });
    expect(await readJsonObject(own({ method: 'POST', body: '' }))).toEqual({});
    expect(await readJsonObject(own({ method: 'POST', body: '[1]' }))).toBeNull();
    expect(await readJsonObject(own({ method: 'POST', body: '"x"' }))).toBeNull();
    expect(await readJsonObject(own({ method: 'POST', body: '{nope' }))).toBeNull();
    expect(await readJsonObject(own({ method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(5000) }) }))).toBeNull();
  });
});

describe('isMailSession', () => {
  const ok = {
    token: 'sbm1.x',
    expiresAt: '2026-11-28T01:00:00Z',
    sessionUrl: 'https://yourtal.gaiada.com/api/spambank/jmap/session',
    helpersBase: 'https://yourtal.gaiada.com/api/spambank/mail',
    address: 'geewizduck@yourtal.gaiada.com',
  };
  it('accepts the §5.1 shape over https', () => {
    expect(isMailSession(ok)).toBe(true);
  });
  it('refuses plain http in production, and allows it only when asked (development)', () => {
    const http = { ...ok, sessionUrl: 'http://localhost:4998/jmap/session', helpersBase: 'http://localhost:4998/mail' };
    expect(isMailSession(http)).toBe(false);
    expect(isMailSession(http, true)).toBe(true);
  });
  it('refuses a session that could send the token somewhere odd or is incomplete', () => {
    expect(isMailSession({ ...ok, sessionUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isMailSession({ ...ok, helpersBase: 'ftp://x.example/' })).toBe(false);
    expect(isMailSession({ ...ok, sessionUrl: 'not a url' })).toBe(false);
    expect(isMailSession({ ...ok, token: '' })).toBe(false);
    expect(isMailSession({ ...ok, expiresAt: 'soon' })).toBe(false);
    expect(isMailSession(null)).toBe(false);
    expect(isMailSession('x')).toBe(false);
  });
});
