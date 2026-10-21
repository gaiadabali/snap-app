import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runYourtalSignIn } from '@/lib/yourtal-signin';

import { activeWorkspaceId, authToken, setActiveWorkspaceId, setAuthToken } from './context';
import { ApiError, HttpApi } from './http';

/**
 * The phone's calls to Sign in with YourTal, against the real `HttpApi` and a
 * fake `fetch`, and that the session it returns is stored the way every
 * sign-in's is (SecureStore, via `setAuthToken`). Storage modules are faked as
 * in session-expiry.test.ts: the keystore is a native module.
 */

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: async (k: string) => {
      storage.delete(k);
    },
  },
}));
const secure = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    secure.delete(k);
  },
}));

type Call = { path: string; method: string; body: unknown; auth: string | null };
let calls: Call[] = [];
const BASE = 'https://api.example.test';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serve(routes: Record<string, (call: Call) => Response>) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      path: new URL(url).pathname,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.Authorization ?? null,
    };
    calls.push(call);
    const route = routes[call.path];
    return route ? route(call) : json(404, { message: 'no route' });
  });
}

const USER = { userId: 'u1', email: 'k@example.com', displayName: 'Kira', initials: 'K' };
const SESSION = {
  token: 'snap-session-token',
  user: USER,
  workspaces: [{ id: 'ws-9' }],
  returnTo: null,
  outcome: 'created',
};
const REDIRECT = 'au.com.snapapps.app:/oauth/yourtal';

describe('Sign in with YourTal against the API client', () => {
  beforeEach(() => {
    calls = [];
    secure.clear();
    storage.clear();
    setAuthToken(null);
    setActiveWorkspaceId(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports the phone client as available only when the server says mobile is on', async () => {
    serve({ '/v1/auth/yourtal': () => json(200, { web: true, mobile: false }) });
    expect(await new HttpApi(BASE).getYourtalSignInAvailable()).toBe(false);
    serve({ '/v1/auth/yourtal': () => json(200, { web: false, mobile: true }) });
    expect(await new HttpApi(BASE).getYourtalSignInAvailable()).toBe(true);
    serve({ '/v1/auth/yourtal': () => json(500, { error: 'x' }) });
    expect(await new HttpApi(BASE).getYourtalSignInAvailable()).toBe(false);
  });

  it('start asks as the mobile client, unauthenticated, and returns the URL and flow id', async () => {
    serve({
      '/v1/auth/yourtal/start': () => json(200, { url: 'https://id.test/a?state=s', flowId: 'f1', expiresAt: 'x' }),
    });
    const r = await new HttpApi(BASE).startYourtalSignIn({ signUp: true });
    expect(r).toMatchObject({ url: 'https://id.test/a?state=s', flowId: 'f1' });
    expect(calls[0]).toMatchObject({ method: 'POST', body: { client: 'mobile', signUp: true }, auth: null });
  });

  it('start, browser, finish: stores the SnapApp session in SecureStore and picks the first workspace', async () => {
    serve({
      '/v1/auth/yourtal/start': () => json(200, { url: 'https://id.test/a?state=s', flowId: 'f1', expiresAt: 'x' }),
      '/v1/auth/yourtal/finish': () => json(200, SESSION),
    });
    const http = new HttpApi(BASE);
    const result = await runYourtalSignIn({
      start: (i) => http.startYourtalSignIn(i),
      openBrowser: async () => ({ type: 'success', url: `${REDIRECT}?code=C0DE&state=s&iss=https%3A%2F%2Fid.test` }),
      finish: (i) => http.finishYourtalSignIn(i),
    });

    expect(result).toEqual({ kind: 'signed-in', session: { user: USER, workspaceIds: ['ws-9'] } });
    expect(calls[1]).toMatchObject({
      path: '/v1/auth/yourtal/finish',
      body: { flowId: 'f1', code: 'C0DE', state: 's', iss: 'https://id.test' },
      auth: null,
    });
    expect(authToken()).toBe('snap-session-token');
    expect(activeWorkspaceId()).toBe('ws-9');
    await vi.waitFor(() => expect(secure.get('snap.auth.token')).toBe('snap-session-token'));
    // Nothing from YourTal is kept: the only stored value is SnapApp's token.
    expect([...secure.values(), ...storage.values()].join(' ')).not.toMatch(/C0DE|id\.test/);
  });

  it('a refusal from finish carries its code and stores no session', async () => {
    serve({ '/v1/auth/yourtal/finish': () => json(403, { error: 'region_not_supported', message: 'server words' }) });
    const err = await new HttpApi(BASE)
      .finishYourtalSignIn({ flowId: 'f', code: 'c', state: 's', iss: 'i' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('region_not_supported');
    expect(authToken()).toBeNull();
  });

  it('the old password sign-in answering use_yourtal surfaces that code', async () => {
    serve({ '/v1/auth/password/sign-in': () => json(403, { error: 'use_yourtal', message: 'server words' }) });
    const err = await new HttpApi(BASE).signInWithPassword('k@example.com', 'x'.repeat(12)).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('use_yourtal');
    expect(authToken()).toBeNull();
  });
});
