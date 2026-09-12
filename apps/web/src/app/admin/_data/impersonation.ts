/**
 * The signed-in staff member's own session, and impersonation start/stop —
 * platform admin, wired to the real admin plane.
 *
 * There is no `GET` to list past or currently-open impersonation sessions —
 * `apps/server/src/admin/impersonation.controller.ts` exposes only `start`
 * and `:sessionId/stop`. Every request made under a live session IS recorded
 * in Postgres `audit_log` by `admin_impersonation_start`/`_stop`/`_verify`
 * (see `packages/db/migrations/0021_admin_plane.sql`), but nothing reads that
 * table back to this app. So there is no `listAuditTrail` or `recordAction`
 * here any more — see `(people)/audit/page.tsx` for how that gap is shown,
 * and the wiring report for the endpoint this needs
 * (something like `GET /v1/admin/audit-log`).
 */
import 'server-only';

import type {
  AdminImpersonationStartResponse,
  AdminImpersonationStopResponse,
  AdminSession,
} from '@snap/api-contract';

import { newIdempotencyKey } from '@/lib/api/server';

import { adminApi, capabilityGated, type Gated } from './client';

/** `GET /v1/admin/me` — who the signed-in caller is on this plane, and what
 * they may do. A 401/403 here means "not platform staff at all", the root
 * gate the whole admin shell renders behind — see `layout.tsx`. */
export async function getAdminSession(): Promise<Gated<AdminSession>> {
  return capabilityGated(() => adminApi<AdminSession>('/v1/admin/me'));
}

export class ImpersonationError extends Error {}

export type StartImpersonationInput = {
  subjectUserId: string;
  subjectTenantId: string;
  reason: string;
};

/**
 * `POST /v1/admin/impersonation/start`. Requires the `impersonate`
 * capability — enforced by the database (`admin_impersonation_start`), which
 * also refuses a reason under 8 characters and a user who is not actually a
 * member of the named tenant. Both refusals surface as a normal `ApiError`
 * (400) with the database's own message, not a generic failure.
 */
export async function startImpersonation(
  input: StartImpersonationInput,
): Promise<AdminImpersonationStartResponse> {
  const reason = input.reason.trim();
  if (reason.length < 8) {
    throw new ImpersonationError('A reason of at least 8 characters is required to start impersonation.');
  }
  return adminApi<AdminImpersonationStartResponse>('/v1/admin/impersonation/start', {
    method: 'POST',
    body: { subjectUserId: input.subjectUserId, subjectTenantId: input.subjectTenantId, reason },
    idempotencyKey: newIdempotencyKey(),
  });
}

/** `POST /v1/admin/impersonation/:sessionId/stop`. No capability gate of its
 * own: the database lets the staff member who started it, or anyone holding
 * `manage_staff`, end it — see the migration. */
export async function stopImpersonation(sessionId: string): Promise<AdminImpersonationStopResponse> {
  return adminApi<AdminImpersonationStopResponse>(
    `/v1/admin/impersonation/${encodeURIComponent(sessionId)}/stop`,
    { method: 'POST', idempotencyKey: newIdempotencyKey() },
  );
}
