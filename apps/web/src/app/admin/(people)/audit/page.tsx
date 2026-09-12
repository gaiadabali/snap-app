import { NotAvailable } from '../../_components/NotAvailable';

export const metadata = { title: 'Audit trail' };

/**
 * Who impersonated whom, when, why, for how long, and what they did —
 * docs/WEB.md §6 point 3 requires all of it to be recorded, and it is:
 * `admin_impersonation_start`/`_stop`/`_verify` each write a row to Postgres
 * `audit_log` (`packages/db/migrations/0021_admin_plane.sql`).
 *
 * But nothing reads that table back. `apps/server/src/admin/` exposes
 * `POST .../start` and `POST .../:sessionId/stop` only — there is no
 * `GET /v1/admin/audit-log` or equivalent, so this page has no way to list
 * past sessions. Per the wiring rule for this surface, that means an honest
 * "not available" screen, not a fixture list and not an empty table
 * pretending nothing has happened.
 */
export default function AuditTrailPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-[var(--color-ink)]">Impersonation audit trail</h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Every impersonation session, who started it, why, and what they viewed — recorded, but not readable from
          here yet.
        </p>
      </div>

      <NotAvailable
        title="Audit trail"
        reason='Every impersonation start, stop, and verified read IS written to Postgres audit_log (packages/db/migrations/0021_admin_plane.sql). There is no GET endpoint that reads it back — apps/server/src/admin/impersonation.controller.ts exposes only start and :sessionId/stop. This page needs something like GET /v1/admin/audit-log (or /v1/admin/impersonation/sessions), gated on a capability such as view_analytics or manage_staff, before it can show real history instead of this notice.'
      />
    </div>
  );
}
