import 'server-only';

import { cookies } from 'next/headers';

import { config } from '../config';

/**
 * The one way this website talks to the Snap API.
 *
 * Everything goes through here, from server components and route handlers, and
 * the session token is read from an httpOnly cookie that browser JavaScript
 * cannot see. The alternative — shipping the bearer token to the client and
 * calling the API directly from the browser — is how a single XSS becomes
 * "an attacker downloaded a tenant's five years of financial records".
 *
 * Consequence to understand before you fight it: client components CANNOT call
 * the API directly. They call a server action or a route handler in this app,
 * which calls this. That is the intended shape, not an obstacle to route around.
 */

export const SESSION_COOKIE = 'snap_session';
export const WORKSPACE_COOKIE = 'snap_workspace';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Overrides the workspace cookie. Pass explicitly for cross-workspace reads. */
  workspaceId?: string;
  /**
   * Required by the server on every workspace-scoped write (migration 0008 +
   * the 1d phase). Two concurrent retries of the same intent must not both
   * proceed, and the server enforces that by this key — so a write without one
   * is a bug, not a shortcut.
   */
  idempotencyKey?: string;
  /** Opt out of the session token, for genuinely public endpoints. */
  anonymous?: boolean;
  /** Next.js fetch cache control. Dashboards should not be cached. */
  cache?: RequestCache;
  revalidate?: number | false;
};

export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function getActiveWorkspaceId(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(WORKSPACE_COOKIE)?.value;
}

/**
 * Call the API.
 *
 * Returns the parsed body, or throws `ApiError` carrying the upstream status —
 * callers distinguish 401 (sign in) from 403 (known, and not allowed), which is
 * a distinction the server makes deliberately in its guards and which a generic
 * "request failed" would throw away.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    workspaceId,
    idempotencyKey,
    anonymous = false,
    cache,
    revalidate,
  } = options;

  const headers: Record<string, string> = { accept: 'application/json' };

  if (!anonymous) {
    const token = await getSessionToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const tenant = workspaceId ?? (await getActiveWorkspaceId());
  if (tenant) headers['x-workspace-id'] = tenant;

  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const isWrite = method !== 'GET';
  if (isWrite && !idempotencyKey) {
    // Loud, in development, because the server will reject it anyway and the
    // resulting error is far less obvious than this one.
    console.warn(`[api] ${method} ${path} sent without an Idempotency-Key.`);
  }

  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // A dashboard that shows last minute's balance is worse than a slow one.
    cache: cache ?? (isWrite ? 'no-store' : 'no-store'),
    ...(revalidate === undefined ? {} : { next: { revalidate } }),
  });

  const text = await response.text();
  const parsed: unknown = text ? safeJson(text) : undefined;

  if (!response.ok) {
    const message =
      (typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : undefined) ?? `${method} ${path} failed with ${response.status}`;
    throw new ApiError(response.status, message, parsed);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A fresh idempotency key. Generate ONE per user intent, not per retry. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
