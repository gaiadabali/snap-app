import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeWorkspaceId, authToken, onSessionEnded, setActiveWorkspaceId, setAuthToken } from './context';
import { ApiError, HttpApi } from './http';

/**
 * What the phone does when the server ends its session (task 1.2.c).
 *
 * Sessions expire now (30 days at most, 14 unused) and can be revoked from
 * elsewhere. The app must notice ONCE, forget the token, show sign-in — and
 * never crash or loop. These drive the real `HttpApi` against a fake `fetch`;
 * the storage modules are faked as in context.test.ts, because the keystore
 * is a native module no Node test can load.
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

type Call = { url: string; method: string; auth: string | null };
let calls: Call[] = [];

/** A fake server: answers by path, records every call. */
function serve(routes: Record<string, (call: Call) => Response>) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call = { url, method: init.method ?? 'GET', auth: headers.Authorization ?? null };
    calls.push(call);
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return json(404, { message: 'no route' });
    return route(call);
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ended401 = () => json(401, { error: 'session_expired', message: 'Your session has ended. Sign in again.' });
const BASE = 'https://api.example.test';

describe('an expired or revoked session on the phone', () => {
  let endedCount = 0;
  let unsubscribe: () => void;

  beforeEach(() => {
    calls = [];
    endedCount = 0;
    secure.clear();
    storage.clear();
    setAuthToken('live-token');
    setActiveWorkspaceId('ws-1');
    unsubscribe = onSessionEnded(() => {
      endedCount += 1;
    });
  });

  afterEach(() => {
    unsubscribe();
    vi.unstubAllGlobals();
  });

  it('a 401 on an authenticated request forgets the token and tells the app once', async () => {
    serve({ '/v1/workspaces': ended401 });
    const api = new HttpApi(BASE);

    await expect(api.listWorkspaces()).rejects.toMatchObject({ status: 401 });

    expect(authToken()).toBeNull();
    expect(activeWorkspaceId()).toBeNull();
    expect(endedCount).toBe(1);
    await vi.waitFor(() => expect(secure.has('snap.auth.token')).toBe(false));
  });

  it('many requests failing together still end the session exactly once — no loop', async () => {
    serve({ '/v1/workspaces': ended401 });
    const api = new HttpApi(BASE);

    const results = await Promise.allSettled([api.listWorkspaces(), api.listWorkspaces(), api.listWorkspaces()]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(endedCount).toBe(1);

    // And afterwards a request carries NO token, so a further 401 ends nothing.
    await expect(api.listWorkspaces()).rejects.toBeInstanceOf(ApiError);
    expect(calls.at(-1)!.auth).toBeNull();
    expect(endedCount).toBe(1);
  });

  it('a wrong password at sign-in is a 401 too, and ends nothing', async () => {
    setAuthToken(null);
    serve({
      '/v1/auth/password/sign-in': () => json(401, { message: 'Email or password is incorrect.' }),
    });
    const api = new HttpApi(BASE);
    await expect(api.signInWithPassword('a@b.test', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      message: 'Email or password is incorrect.',
    });
    expect(endedCount).toBe(0);
  });

  it('a 401 for an OLD token does not sign out a newer session', async () => {
    // A slow request sent before a fresh sign-in comes back 401 afterwards.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal('fetch', async () => {
      await gate;
      return ended401();
    });
    const api = new HttpApi(BASE);
    const slow = api.listWorkspaces();
    setAuthToken('newer-token');
    release();
    await expect(slow).rejects.toMatchObject({ status: 401 });
    expect(authToken()).toBe('newer-token');
    expect(endedCount).toBe(0);
  });

  it('getSession on a cold start with an expired token answers "signed out", not an error', async () => {
    serve({ '/v1/auth/session': ended401 });
    const api = new HttpApi(BASE);
    await expect(api.getSession()).resolves.toBeNull();
    expect(authToken()).toBeNull();
  });

  it('a listener that throws does not stop the token being cleared', async () => {
    const off = onSessionEnded(() => {
      throw new Error('a screen blew up');
    });
    try {
      serve({ '/v1/workspaces': ended401 });
      await expect(new HttpApi(BASE).listWorkspaces()).rejects.toMatchObject({ status: 401 });
      expect(authToken()).toBeNull();
      expect(endedCount).toBe(1);
    } finally {
      off();
    }
  });

  it('a 403 (signed in, not allowed) is NOT treated as an ended session', async () => {
    serve({ '/v1/workspaces': () => json(403, { message: 'Not a member.' }) });
    await expect(new HttpApi(BASE).listWorkspaces()).rejects.toMatchObject({ status: 403 });
    expect(authToken()).toBe('live-token');
    expect(endedCount).toBe(0);
  });
});

describe('signing out ends the session on the server too', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the token to /v1/auth/sign-out and forgets it locally', async () => {
    calls = [];
    setAuthToken('to-revoke');
    serve({ '/v1/auth/sign-out': () => new Response(null, { status: 204 }) });
    await new HttpApi(BASE).signOut();
    expect(authToken()).toBeNull();
    await vi.waitFor(() =>
      expect(calls).toContainEqual({ url: `${BASE}/v1/auth/sign-out`, method: 'POST', auth: 'Bearer to-revoke' }),
    );
  });

  it('still signs out locally when offline', async () => {
    setAuthToken('offline-token');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Network request failed');
    });
    await expect(new HttpApi(BASE).signOut()).resolves.toBeUndefined();
    expect(authToken()).toBeNull();
  });
});
