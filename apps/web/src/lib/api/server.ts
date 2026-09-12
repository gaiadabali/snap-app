import 'server-only';

import { cookies } from 'next/headers';

import { config } from '../config';
import {
  IMPERSONATION_COOKIE,
  getImpersonation,
  type ImpersonationCookiePayload,
} from '../impersonation-cookie';

// Re-exported so existing callers keep one import site. The DEFINITION lives
// in `lib/impersonation-cookie.ts` because the admin console writes the cookie
// and the panels read it, and two modules agreeing by convention is exactly
// what broke it: different name, different path, different field names.
export { IMPERSONATION_COOKIE, getImpersonation, type ImpersonationCookiePayload };

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

/**
 * Thrown instead of a plain `ApiError` when a request carrying
 * `X-Impersonation-Token` comes back 401 or 403.
 *
 * `admin_impersonation_verify` runs on every single call (not once at session
 * start), so this is exactly the shape of "the session died between two
 * clicks" — natural expiry, an explicit stop from the admin console, or a
 * revoked capability — never a normal permissions error. Callers use this to
 * show "that session ended" instead of a raw error, and to know the
 * impersonation cookie is now dead weight worth clearing.
 */
export class ImpersonationEndedError extends ApiError {
  constructor(status: number, message: string, body?: unknown) {
    super(status, message, body);
    this.name = 'ImpersonationEndedError';
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
  /**
   * Force the ordinary session bearer even while an impersonation cookie is
   * present. The one legitimate use is the "exit impersonation" call itself:
   * the admin plane's stop endpoint is unreachable BY DESIGN under an
   * impersonation token (`StaffGuard` refuses it — the escalation that closes
   * is staff impersonating another staff member and inheriting their admin
   * capabilities), so ending a session has to be asked for as the staff
   * member, not as the subject.
   */
  bypassImpersonation?: boolean;
  /** Next.js fetch cache control. Dashboards should not be cached. */
  cache?: RequestCache;
  revalidate?: number | false;
};

export async function getSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function getActiveWorkspaceId(): Promise<string | undefined> {
  // An impersonation session is opened FOR ONE TENANT and pinned there
  // server-side (`MembershipGuard`) — reading the ordinary workspace cookie
  // here instead would let a stale or foreign `snap_workspace` value pick a
  // DIFFERENT workspace than the one the session was actually opened for,
  // and every write would then 403. Forcing it here means every caller of
  // `getActiveWorkspaceId()` — every panel layout and page — is correct by
  // construction rather than by remembering to special-case impersonation.
  const impersonation = await getImpersonation();
  if (impersonation) return impersonation.tenantId;
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
    bypassImpersonation = false,
    cache,
    revalidate,
  } = options;

  const headers: Record<string, string> = { accept: 'application/json' };

  // When an impersonation cookie is present, it REPLACES the ordinary bearer
  // — the two are never sent together, and `SessionGuard` on the other end
  // does not expect them to be (see its comments). This is additive: with no
  // cookie, `impersonation` is null and every line below behaves exactly as
  // it did before this existed.
  const impersonation = anonymous || bypassImpersonation ? null : await getImpersonation();

  if (!anonymous) {
    if (impersonation) {
      headers['x-impersonation-token'] = impersonation.token;
    } else {
      const token = await getSessionToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
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
    // Verified per request, so this is the shape of a session that died mid
    // browse, not an ordinary permissions error — see `ImpersonationEndedError`.
    if (impersonation && (response.status === 401 || response.status === 403)) {
      throw new ImpersonationEndedError(response.status, message, parsed);
    }
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
