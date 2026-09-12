/**
 * Impersonation sessions and the audit trail — platform admin.
 *
 * FIXTURE-BACKED, in-memory, per docs/WEB.md §6:
 *
 *   "Impersonation is a session, not a mode. Entering a tenant as a user
 *    mints a distinct, short-lived, revocable token that is visibly marked.
 *    Every request made under it is attributed to BOTH the staff member and
 *    the subject in audit_log. It expires on its own."
 *
 * The real version of this is a signed, revocable token minted by the server
 * and a `SECURITY DEFINER` write into `audit_log` — neither exists yet (the
 * admin backend is being built in parallel). This module stands in with a
 * process-local Map so the UI — the banner, the countdown, the confirmation
 * step, the audit view — can be built and driven end to end now. Swapping
 * `startImpersonation`/`endImpersonation`/`listAuditTrail` for real `api()`
 * calls is a change inside this file only.
 *
 * `../_lib/impersonation-cookie.ts` is the only other file that knows this
 * module exists on the server side; everything else goes through the
 * exported functions here.
 */
import 'server-only';

import { TENANTS, USERS } from '../_fixtures/seed';

export const IMPERSONATION_TTL_MS = 15 * 60 * 1000; // short-lived, on purpose

export type CurrentStaff = { id: string; name: string; role: 'platform_admin' | 'platform_support' };

/**
 * The signed-in platform operator.
 *
 * FIXTURE. There is no staff/identity table yet (`0015_identity_plane.sql`
 * is schema-only per docs/WEB.md §6 point 1) so this is a single hardcoded
 * operator rather than a real session. Every write below attributes to this
 * identity — replace with the real staff session once it exists.
 */
export function getCurrentStaff(): CurrentStaff {
  return { id: 'staff_priya_nathan', name: 'Priya Nathan', role: 'platform_admin' };
}

export type ImpersonationSession = {
  id: string;
  staffId: string;
  staffName: string;
  subjectUserId: string;
  subjectName: string;
  subjectEmail: string;
  tenantId: string | null;
  tenantName: string | null;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedBy: 'staff' | 'expiry' | null;
};

export type AuditAction = { at: string; detail: string };

export type AuditEntry = {
  sessionId: string;
  staffName: string;
  subjectName: string;
  tenantName: string | null;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: 'staff' | 'expiry' | null;
  durationSeconds: number | null;
  actions: AuditAction[];
};

// Stored on `globalThis`, not a plain module-level `const`.
//
// Next.js's App Router compiles this module separately for the "action"
// layer (server actions like `startImpersonationAction`) and the "rsc" layer
// (server components like `AdminLayout`) — in dev, that means TWO instances
// of this module, each with its own module-level state. A plain
// `new Map()` here would let a session start in one instance and be
// invisible to `getActiveSession` reading the other, which is exactly the
// "banner never appears after starting impersonation" bug this shape is
// written to avoid. `globalThis` is the one thing every layer shares —
// the identical trick used for a Prisma client singleton in dev.
//
// This also resets on server restart — a real audit_log survives that; the
// globalThis wrinkle is the fixture-only part, not a design decision to carry
// into the real backend.
const globalStore = globalThis as unknown as {
  __snapAdminImpersonationSessions?: Map<string, ImpersonationSession>;
  __snapAdminImpersonationActions?: Map<string, AuditAction[]>;
};
const sessions = (globalStore.__snapAdminImpersonationSessions ??= new Map<string, ImpersonationSession>());
const actionsBySession = (globalStore.__snapAdminImpersonationActions ??= new Map<string, AuditAction[]>());

export type StartImpersonationInput = { subjectUserId: string; reason: string };

export class ImpersonationError extends Error {}

export async function startImpersonation(input: StartImpersonationInput): Promise<ImpersonationSession> {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    throw new ImpersonationError('A reason of at least 8 characters is required to start impersonation.');
  }
  const subject = USERS.find((u) => u.id === input.subjectUserId);
  if (!subject) throw new ImpersonationError('Unknown user.');
  const tenant = TENANTS.find((t) => t.id === subject.memberships[0]?.tenantId) ?? null;
  const staff = getCurrentStaff();
  const now = Date.now();
  const session: ImpersonationSession = {
    id: crypto.randomUUID(),
    staffId: staff.id,
    staffName: staff.name,
    subjectUserId: subject.id,
    subjectName: subject.displayName,
    subjectEmail: subject.email,
    tenantId: tenant?.id ?? null,
    tenantName: tenant?.name ?? null,
    reason,
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + IMPERSONATION_TTL_MS).toISOString(),
    endedAt: null,
    endedBy: null,
  };
  sessions.set(session.id, session);
  actionsBySession.set(session.id, [{ at: session.startedAt, detail: `Session opened for ${session.tenantName ?? 'no workspace'}` }]);
  return session;
}

/** Returns the session only while it is genuinely active — expired sessions read as gone. */
export async function getActiveSession(sessionId: string): Promise<ImpersonationSession | null> {
  const s = sessions.get(sessionId);
  if (!s || s.endedAt) return null;
  if (Date.parse(s.expiresAt) <= Date.now()) {
    await endImpersonation(sessionId, 'expiry');
    return null;
  }
  return s;
}

export async function endImpersonation(sessionId: string, endedBy: 'staff' | 'expiry' = 'staff'): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.endedAt) return;
  s.endedAt = new Date().toISOString();
  s.endedBy = endedBy;
  const list = actionsBySession.get(sessionId) ?? [];
  list.push({ at: s.endedAt, detail: endedBy === 'expiry' ? 'Session expired automatically' : 'Session ended by staff (exit)' });
  actionsBySession.set(sessionId, list);
}

/** Records one action taken while a session is open — surfaced later in the audit trail's "what they did". */
export async function recordAction(sessionId: string, detail: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s || s.endedAt) return;
  const list = actionsBySession.get(sessionId) ?? [];
  list.push({ at: new Date().toISOString(), detail });
  actionsBySession.set(sessionId, list);
}

function toEntry(s: ImpersonationSession): AuditEntry {
  const durationSeconds = s.endedAt
    ? Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)
    : null;
  return {
    sessionId: s.id,
    staffName: s.staffName,
    subjectName: s.subjectName,
    tenantName: s.tenantName,
    reason: s.reason,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    endedBy: s.endedBy,
    durationSeconds,
    actions: actionsBySession.get(s.id) ?? [],
  };
}

export async function listAuditTrail(): Promise<AuditEntry[]> {
  return [...sessions.values()]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map(toEntry);
}
