import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '@/lib/api/server';

import { middleware } from './middleware.js';

function requestFor(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(new URL(path, 'http://127.0.0.1:3000'), { headers });
}

describe('middleware — guards /app/* and /admin/*', () => {
  it('refuses an unauthenticated request to /app/* — redirected to sign-in', () => {
    const response = middleware(requestFor('/app'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('returnTo')).toBe('/app');
  });

  it('refuses an unauthenticated request to /admin/* — redirected to sign-in', () => {
    const response = middleware(requestFor('/admin/tenants'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('returnTo')).toBe('/admin/tenants');
  });

  it('preserves the query string in returnTo', () => {
    const response = middleware(requestFor('/app/business/reports?period=2026-q1'));
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('returnTo')).toBe('/app/business/reports?period=2026-q1');
  });

  it('lets an authenticated request through — no redirect', () => {
    const response = middleware(requestFor('/app', 'a-session-token'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('a cookie with an EMPTY value is treated as no session, not as signed in', () => {
    // Guards against `jar.get(...)?.value` ever being an empty string that a
    // looser `!== undefined` check would have let through.
    const response = middleware(requestFor('/app', ''));
    expect(response.status).toBe(307);
  });
});
