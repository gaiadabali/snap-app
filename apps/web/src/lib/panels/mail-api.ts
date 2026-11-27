import { MailError } from '@snap/mail-engine';
import type { MailErrorCode, MailSession } from '@snap/mail-engine';

import type { AppPasswordItem, MailSettings, MailStatementImport, MailStatus, NewAppPassword } from './mail-types';

/**
 * Browser-side calls to this site's own `/api/mail/*` (the BFF in `app/api/mail`).
 * Plain `fetch`; the session cookie rides along and the page never sees an API host.
 *
 * Failures: the management calls throw `MailApiFailure` (a code and a sentence the
 * screen can show). `fetchMailSession`, which the engine calls, throws `MailError`,
 * the one error type the engine and its hooks understand.
 */

export class MailApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MailApiFailure';
  }
}

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
  } catch {
    throw new MailApiFailure('network', 'Could not reach SnapApps. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const code = typeof rec['code'] === 'string' ? rec['code'] : 'error';
    const message = typeof rec['message'] === 'string' ? rec['message'] : 'Something went wrong. Try again in a moment.';
    throw new MailApiFailure(code, message, res.status);
  }
  return { status: res.status, body };
}

/** What `getSession` hands the engine. Errors become `MailError` so hooks show the right words. */
export async function fetchMailSession(): Promise<MailSession> {
  try {
    const { body } = await request('/api/mail/session', { method: 'POST' });
    return body as MailSession;
  } catch (e) {
    if (!(e instanceof MailApiFailure)) throw e;
    let code: MailErrorCode = 'unavailable';
    if (e.status === 401) code = 'unauthorized';
    else if (e.code === 'not_enabled') code = 'not_enabled';
    else if (e.code === 'yourtal_not_linked') code = 'unauthorized';
    else if (e.status === 429) code = 'rate_limited';
    else if (e.code === 'network') code = 'network';
    throw new MailError(code, e.message, { status: e.status });
  }
}

export const mailApi = {
  status: async (): Promise<MailStatus> => (await request('/api/mail/status')).body as MailStatus,

  enable: async (): Promise<{ state: 'on'; address: string; created: boolean }> =>
    (await request('/api/mail/enable', { method: 'POST' })).body as { state: 'on'; address: string; created: boolean },

  saveSettings: async (patch: Partial<MailSettings>): Promise<MailSettings> =>
    (await request('/api/mail/settings', { method: 'PATCH', body: JSON.stringify(patch) })).body as MailSettings,

  listAppPasswords: async (): Promise<AppPasswordItem[]> => {
    const body = (await request('/api/mail/app-passwords')).body as { items?: AppPasswordItem[] } | undefined;
    return body?.items ?? [];
  },

  createAppPassword: async (name: string): Promise<NewAppPassword> =>
    (await request('/api/mail/app-passwords', { method: 'POST', body: JSON.stringify({ name }) })).body as NewAppPassword,

  revokeAppPassword: async (id: string): Promise<void> => {
    await request(`/api/mail/app-passwords/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Statements imported from this mailbox, newest first (Spambank T12). */
  imports: async (): Promise<MailStatementImport[]> => {
    const body = (await request('/api/mail/imports')).body as { items?: MailStatementImport[] } | undefined;
    return body?.items ?? [];
  },
};
