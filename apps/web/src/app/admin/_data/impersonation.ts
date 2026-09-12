/**
 * The signed-in staff member's own session, and impersonation start/stop —
 * platform admin, wired to the real admin plane.
 *
 * There is still no `GET` to list past or currently-open impersonation
 * SESSIONS as such — `apps/server/src/admin/impersonation.controller.ts`
 * exposes only `start` and `:sessionId/stop`. But every request made under a
 * live session IS recorded in Postgres `audit_log`
 * (`admin_impersonation_start`/`_stop`/`_verify`, `0021_admin_plane.sql`), and
 * as of migration 0023 that log is readable — see `_data/audit.ts`
 * (`GET /v1/admin/audit-log`, gated on `audit_review`) and
 * `(people)/audit/page.tsx`. That is the closest thing to a session history
 * this console has: a list of who impersonated whom and when, reconstructed
 * from the audit trail rather than a dedicated sessions endpoint.
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
