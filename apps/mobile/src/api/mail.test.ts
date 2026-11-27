import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MailError } from '@snap/mail-engine';

import { setActiveWorkspaceId, setAuthToken } from './context';
import { ApiError, HttpApi } from './http';
import { sessionFailure } from '@/lib/mail-client';

/**
 * The phone's calls to SnapApp's `/v1/mail/*` and `/v1/devices/push-token` (the T11 bridge),
 * against the real `HttpApi` and a fake `fetch`: the paths, the bodies, that they are the
 * person's own (no workspace header), that none is queued for replay, and how the bridge's
 * `{ error, message }` refusals arrive. Storage modules are faked as in the other API tests.
 */

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
// mail-client pulls in the phone's filesystem module, which Node cannot load.
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { cache: '' } }));

type Call = { path: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
const BASE = 'https://api.example.test';

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function serve(handler: (call: Call) => Response) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      path: new URL(url).pathname,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return handler(call);
  });
}

describe('Spambank mail against the API client', () => {
  beforeEach(() => {
    calls = [];
    setAuthToken('snap-session-token');
    // An active workspace is set on purpose: mail calls are the person's own and must not carry it.
    setActiveWorkspaceId('ws-1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
    setActiveWorkspaceId(null);
  });

  it('reads the status with the person’s own session and no workspace', async () => {
    const status = { available: true, linked: false, mailbox: null, settings: { statements: false, workspaceId: null, alerts: true } };
    serve(() => json(200, status));
    expect(await new HttpApi(BASE).getMailStatus()).toEqual(status);
    expect(calls[0]).toMatchObject({ path: '/v1/mail/status', method: 'GET' });
    expect(calls[0]!.headers.Authorization).toBe('Bearer snap-session-token');
    expect(calls[0]!.headers['X-Workspace-Id']).toBeUndefined();
  });

  it('switches mail on, takes a session token, and none of it carries a workspace', async () => {
    serve((c) =>
      c.path === '/v1/mail/enable'
        ? json(201, { state: 'on', address: 'geewizduck@yourtal.gaiada.com', created: true })
        : json(200, { token: 't', expiresAt: '2026-11-27T02:00:00Z', sessionUrl: 'https://p/jmap/session', helpersBase: 'https://p/mail', address: 'a@b.co' }),
    );
    const http = new HttpApi(BASE);
    expect(await http.enableMail()).toEqual({ state: 'on', address: 'geewizduck@yourtal.gaiada.com', created: true });
    expect((await http.createMailSession()).token).toBe('t');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/mail/enable', 'POST /v1/mail/session']);
    for (const c of calls) expect(c.headers['X-Workspace-Id']).toBeUndefined();
  });

  it('patches settings with only what changed, and answers the settings as they now are', async () => {
    serve(() => json(200, { statements: true, workspaceId: 'ws-1', alerts: true }));
    const out = await new HttpApi(BASE).updateMailSettings({ statements: true, workspaceId: 'ws-1' });
    expect(out).toEqual({ statements: true, workspaceId: 'ws-1', alerts: true });
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/v1/mail/settings', body: { statements: true, workspaceId: 'ws-1' } });
  });

  it('lists, creates and revokes app passwords', async () => {
    serve((c) => {
      if (c.method === 'GET') return json(200, { items: [{ id: 'ap1', name: 'Pixel', createdAt: '2026-11-27T00:00:00Z' }] });
      if (c.method === 'POST') {
        return json(201, {
          id: 'ap2', name: 'Pixel 2', createdAt: 'x', secret: 's3cret', username: 'a@b.co',
          imap: { host: 'h', port: 993, security: 'ssl' }, smtp: { host: 'h', port: 465, security: 'ssl' },
        });
      }
      return json(204);
    });
    const http = new HttpApi(BASE);
    expect(await http.listMailAppPasswords()).toEqual([{ id: 'ap1', name: 'Pixel', createdAt: '2026-11-27T00:00:00Z' }]);
    expect((await http.createMailAppPassword('Pixel 2')).secret).toBe('s3cret');
    await http.revokeMailAppPassword('ap 1/../x');
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/v1/mail/app-passwords', body: { name: 'Pixel 2' } });
    // The id is encoded into the path, never trusted as one.
    expect(calls[2]).toMatchObject({ method: 'DELETE' });
    expect(calls[2]!.path).toBe('/v1/mail/app-passwords/ap%201%2F..%2Fx');
  });

  it('treats an answer with no items as an empty list', async () => {
    serve(() => json(200, {}));
    expect(await new HttpApi(BASE).listMailAppPasswords()).toEqual([]);
  });

  it('registers and withdraws this phone’s Firebase token', async () => {
    serve(() => json(204));
    const http = new HttpApi(BASE);
    await http.registerPushToken('fcm-token-abcdefghijklmnop');
    await http.unregisterPushToken('fcm-token-abcdefghijklmnop');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v1/devices/push-token', body: { token: 'fcm-token-abcdefghijklmnop', platform: 'android' } });
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/v1/devices/push-token', body: { token: 'fcm-token-abcdefghijklmnop' } });
    for (const c of calls) expect(c.headers['X-Workspace-Id']).toBeUndefined();
  });

  it('carries the bridge’s refusal as an ApiError with its code', async () => {
    serve(() => json(409, { error: 'yourtal_not_linked', message: 'Sign in with YourTal to use your Spambank mail.' }));
    const e = await new HttpApi(BASE).enableMail().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: 'yourtal_not_linked' });
  });

  it('never queues a mail write for replay when the phone is offline', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const http = new HttpApi(BASE);
    for (const run of [
      () => http.enableMail(),
      () => http.createMailSession(),
      () => http.updateMailSettings({ alerts: false }),
      () => http.createMailAppPassword('x'),
      () => http.revokeMailAppPassword('a'),
      () => http.registerPushToken('t'.repeat(30)),
      () => http.unregisterPushToken('t'.repeat(30)),
    ]) {
      const e = await run().catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 0, code: 'offline' });
    }
  });
});

describe('sessionFailure', () => {
  it('turns the bridge’s refusals into the engine’s error codes', () => {
    const f = (status: number, code: string | null) => sessionFailure(new ApiError(status, 'x', code)).code;
    expect(f(401, null)).toBe('unauthorized');
    expect(f(409, 'yourtal_not_linked')).toBe('unauthorized');
    expect(f(409, 'not_enabled')).toBe('not_enabled');
    expect(f(429, 'rate_limited')).toBe('rate_limited');
    expect(f(0, 'offline')).toBe('network');
    expect(f(503, 'yourtal_unavailable')).toBe('unavailable');
  });

  it('keeps an engine error and wraps anything else', () => {
    const own = new MailError('rate_limited');
    expect(sessionFailure(own)).toBe(own);
    expect(sessionFailure(new Error('boom')).code).toBe('unavailable');
    expect(sessionFailure('nope').code).toBe('unavailable');
  });
});
