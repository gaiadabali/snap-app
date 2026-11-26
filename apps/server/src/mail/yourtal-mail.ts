import { randomUUID } from 'node:crypto';

import { oidcApiCall } from '../yourtal/oidc-client-api.js';

/**
 * SnapApp's calls to YourTal's Spambank machine API (spambank/BUILD.md §5.2):
 * `POST /api/oidc-clients/spambank/*` behind a client-credentials token with
 * scope `spambank` (the token and 401 retry are `yourtal/oidc-client-api.ts`).
 * The person is always named by THIS app's pairwise `sub`; YourTal resolves it,
 * checks consent, adulthood and suspension, and answers for that person only.
 *
 * Nothing here logs a body, a `sub`, a token or an app-password secret: a
 * failure is logged as its status and code alone, by the caller.
 */

export const SPAMBANK_SCOPE = 'spambank';
export const SPAMBANK_PATH = '/api/oidc-clients/spambank';

/** Why a call did not come back with a usable answer. */
export type MailFailure =
  /** YourTal did not answer, or answered 5xx, or would not give us a token. */
  | 'unavailable'
  /** YourTal's mail server is down (503 `spambank_unavailable`). */
  | 'spambank_unavailable'
  /** 404 `unknown_subject`: YourTal does not know this `sub` here. */
  | 'unknown_subject'
  /** 403 `not_allowed`: a teen, suspended, or consent to this app ended. */
  | 'not_allowed'
  /** 409 `not_enabled`: no mailbox yet. */
  | 'not_enabled'
  /** 429. */
  | 'rate_limited'
  /** Anything else: our request was refused (a missing scope, a route that is not there, a bad body). */
  | 'rejected';

export type MailCall =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; reason: MailFailure; status: number | null; code: string | null };

function classify(status: number, code: string | null): MailFailure {
  if (status === 503 && code === 'spambank_unavailable') return 'spambank_unavailable';
  if (status >= 500) return 'unavailable';
  if (status === 404 && code === 'unknown_subject') return 'unknown_subject';
  if (status === 403 && code === 'not_allowed') return 'not_allowed';
  if (status === 409 && code === 'not_enabled') return 'not_enabled';
  if (status === 429) return 'rate_limited';
  return 'rejected';
}

async function call(path: string, body: object, idempotent = false): Promise<MailCall> {
  let answer: Awaited<ReturnType<typeof oidcApiCall>>;
  try {
    answer = await oidcApiCall(SPAMBANK_SCOPE, 'POST', `${SPAMBANK_PATH}${path}`, body, idempotent ? randomUUID() : undefined);
  } catch {
    return { ok: false, reason: 'unavailable', status: null, code: null };
  }
  if (!answer) return { ok: false, reason: 'unavailable', status: null, code: null };
  if (answer.status >= 200 && answer.status < 300) return { ok: true, status: answer.status, body: answer.body };
  const code = typeof answer.body.code === 'string' ? answer.body.code : null;
  return { ok: false, reason: classify(answer.status, code), status: answer.status, code };
}

/** `/status`: the mailbox and its settings. */
export const yourtalMailStatus = (sub: string): Promise<MailCall> => call('/status', { sub });

/** `/enable`: creates the mailbox (201) or returns the existing one (200). Safe to repeat. */
export const yourtalMailEnable = (sub: string): Promise<MailCall> => call('/enable', { sub }, true);

/** `/session`: a 30-minute mail token. */
export const yourtalMailSession = (sub: string): Promise<MailCall> => call('/session', { sub });

/** `/settings` (SnapApp's sector only): the two switches YourTal keeps. */
export const yourtalMailSettings = (
  sub: string,
  change: { statementsToSnapApp?: boolean; newMailAlerts?: boolean },
): Promise<MailCall> => call('/settings', { sub, ...change });

export const yourtalAppPasswordList = (sub: string): Promise<MailCall> => call('/app-passwords/list', { sub });

export const yourtalAppPasswordCreate = (sub: string, name: string): Promise<MailCall> =>
  call('/app-passwords', { sub, name });

export const yourtalAppPasswordRevoke = (sub: string, id: string): Promise<MailCall> =>
  call('/app-passwords/revoke', { sub, id });

// ── Shaping YourTal's answers ────────────────────────────────────────────────
//
// Each answer is rebuilt field by field, so only what the contract names reaches
// a client, whatever else YourTal adds, and an answer that is not the shape
// promised is `null` (the caller reports yourtal_rejected) rather than passed on.

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const MAILBOX_STATES = ['off', 'on', 'suspended', 'not_allowed'] as const;
export type MailboxShape = {
  state: (typeof MAILBOX_STATES)[number];
  address?: string;
  quota?: { limitBytes: number; usedBytes: number };
  createdAt?: string;
};

/** `/status` → the mailbox, and the two switches YourTal keeps. Null when `state` is not one we know. */
export function shapeStatus(body: Rec): { mailbox: MailboxShape; statements: boolean | null; alerts: boolean | null } | null {
  const state = MAILBOX_STATES.find((s) => s === body.state);
  if (!state) return null;
  const address = str(body.address);
  const createdAt = str(body.createdAt);
  const quota = isRec(body.quota) && num(body.quota.limitBytes) !== undefined && num(body.quota.usedBytes) !== undefined
    ? { limitBytes: body.quota.limitBytes as number, usedBytes: body.quota.usedBytes as number }
    : undefined;
  const settings = isRec(body.settings) ? body.settings : {};
  return {
    mailbox: { state, ...(address ? { address } : {}), ...(quota ? { quota } : {}), ...(createdAt ? { createdAt } : {}) },
    statements: typeof settings.statementsToSnapApp === 'boolean' ? settings.statementsToSnapApp : null,
    alerts: typeof settings.newMailAlerts === 'boolean' ? settings.newMailAlerts : null,
  };
}

/** `/enable` → `{ state: 'on', address, created }`. */
export function shapeEnable(body: Rec, created: boolean): { state: 'on'; address: string; created: boolean } | null {
  const address = str(body.address);
  return body.state === 'on' && address ? { state: 'on', address, created } : null;
}

/** `/session` → the five fields the engine reads. */
export function shapeSession(
  body: Rec,
): { token: string; expiresAt: string; sessionUrl: string; helpersBase: string; address: string } | null {
  const token = str(body.token);
  const expiresAt = str(body.expiresAt);
  const sessionUrl = str(body.sessionUrl);
  const helpersBase = str(body.helpersBase);
  const address = str(body.address);
  return token && expiresAt && sessionUrl && helpersBase && address ? { token, expiresAt, sessionUrl, helpersBase, address } : null;
}

export type AppPasswordShape = { id: string; name: string; createdAt: string };

function shapeAppPassword(v: unknown): AppPasswordShape | null {
  if (!isRec(v)) return null;
  const id = str(v.id);
  const name = str(v.name);
  const createdAt = str(v.createdAt);
  return id && name && createdAt ? { id, name, createdAt } : null;
}

/** `/app-passwords/list` → the list. An item that is not the shape promised makes the whole answer null. */
export function shapeAppPasswordList(body: Rec): { items: AppPasswordShape[] } | null {
  if (!Array.isArray(body.items)) return null;
  const items = body.items.map(shapeAppPassword);
  return items.every((i): i is AppPasswordShape => i !== null) ? { items } : null;
}

function shapeServer(v: unknown): { host: string; port: number; security: 'ssl' } | null {
  if (!isRec(v)) return null;
  const host = str(v.host);
  const port = num(v.port);
  return host && port !== undefined && v.security === 'ssl' ? { host, port, security: 'ssl' } : null;
}

/** `/app-passwords` → the new password, with its secret (shown once) and the phone settings. */
export function shapeAppPasswordCreated(body: Rec): (AppPasswordShape & {
  secret: string;
  username: string;
  imap: { host: string; port: number; security: 'ssl' };
  smtp: { host: string; port: number; security: 'ssl' };
}) | null {
  const base = shapeAppPassword(body);
  const secret = str(body.secret);
  const username = str(body.username);
  const imap = shapeServer(body.imap);
  const smtp = shapeServer(body.smtp);
  return base && secret && username && imap && smtp ? { ...base, secret, username, imap, smtp } : null;
}
