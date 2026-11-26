import 'server-only';

import type { MailSession } from '@snap/mail-engine';

import { api, ApiError, getImpersonation, newIdempotencyKey } from '@/lib/api/server';
import { crossSite } from '@/lib/http/same-origin';

/**
 * The same-origin door to SnapApp's `/v1/mail/*` (spambank/BUILD.md §5.6).
 *
 * The browser never calls the API host: the route handlers under `/api/mail/*` call
 * `mailForward`, which checks the request came from this site's own pages, forwards it
 * with the session cookie (`api()` reads it), and answers `{ code, message }` on any
 * failure. Four rules live here and nowhere else:
 *
 *  - a cross-site request is refused (403), the same check the other route handlers use;
 *  - nothing is forwarded while platform staff is impersonating a person: their mailbox
 *    is private and a mail token minted from an impersonation session would open it;
 *  - only the fields the caller names are forwarded (each route whitelists its body);
 *  - every answer is `no-store`: a mail token or a one-time app password must never be
 *    cached by the browser or an intermediary.
 */

const NO_STORE = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };

export function mailJson(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}

export const mailError = (status: number, code: string, message: string): Response =>
  mailJson(status, { code, message });

/** The code SnapApp's API sent (`code`, or the older `error` field), or a generic one. */
export function upstreamCode(body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const rec = body as Record<string, unknown>;
    for (const key of ['code', 'error']) {
      const v = rec[key];
      if (typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v)) return v;
    }
  }
  return 'error';
}

/** A sentence for each code the screens act on; the server's own wording is never passed through. */
const MESSAGES: Record<string, string> = {
  yourtal_not_linked: 'Sign in with YourTal to use mail.',
  not_allowed: 'Mail is not available for this account.',
  not_enabled: 'Mail is not switched on yet.',
  spambank_unavailable: 'Mail is not available right now. Try again in a moment.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  too_many_app_passwords: 'You have reached the limit of app passwords. Revoke one first.',
};

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong. Try again in a moment.';
}

export interface ForwardSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path on SnapApp's API, always starting `/v1/mail/`. */
  path: string;
  body?: unknown;
  /** Return false to refuse an upstream success whose shape is not the one expected. */
  accept?: (data: unknown) => boolean;
  /** Success status to answer with when upstream sends a body, e.g. 201. Default: upstream's 200. */
  successStatus?: number;
}

export async function mailForward(req: Request, spec: ForwardSpec): Promise<Response> {
  if (crossSite(req)) return mailError(403, 'forbidden', 'Request refused.');
  if (await getImpersonation()) {
    return mailError(403, 'impersonating', 'Mail is private and is not available while acting as someone else.');
  }
  try {
    const data = await api<unknown>(spec.path, {
      method: spec.method,
      ...(spec.body === undefined ? {} : { body: spec.body }),
      idempotencyKey: spec.method === 'GET' ? undefined : newIdempotencyKey(),
    });
    if (spec.accept && !spec.accept(data)) {
      return mailError(502, 'bad_gateway', 'Mail answered in a way we did not expect.');
    }
    if (data === undefined || data === null) return mailJson(spec.method === 'DELETE' ? 204 : 200, {});
    return mailJson(spec.successStatus ?? 200, data);
  } catch (error) {
    if (error instanceof ApiError) {
      const code = upstreamCode(error.body);
      // 401 from upstream means the session ended; every other status is passed through as is.
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return mailError(status, code, messageFor(code));
    }
    return mailError(502, 'bad_gateway', 'Could not reach mail. Try again in a moment.');
  }
}

/** Reads a small JSON object body. `null` when it is missing, too large or not an object. */
export async function readJsonObject(req: Request, maxBytes = 4096): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length > maxBytes) return null;
  try {
    const value: unknown = JSON.parse(text === '' ? '{}' : text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The mail session is what the engine sends the token to, so its URLs are checked
 * before they leave this server: https only (plain http only outside production).
 */
export function isMailSession(value: unknown, allowHttp = false): value is MailSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const strings = ['token', 'expiresAt', 'sessionUrl', 'helpersBase', 'address'] as const;
  if (!strings.every((k) => typeof v[k] === 'string' && (v[k] as string) !== '')) return false;
  for (const key of ['sessionUrl', 'helpersBase'] as const) {
    try {
      const u = new URL(v[key] as string);
      if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return false;
    } catch {
      return false;
    }
  }
  return !Number.isNaN(Date.parse(v['expiresAt'] as string));
}
