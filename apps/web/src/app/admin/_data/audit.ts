/**
 * The audit trail — `GET /v1/admin/audit-log` (`admin_audit_log_search`,
 * migration 0023), gated on `audit_review`.
 *
 * Previously nothing read `audit_log` back at all (see the old
 * `(people)/audit/page.tsx`, which rendered an honest `NotAvailable` panel
 * naming exactly this gap) even though every impersonation start/stop/verify
 * and every tenant/user metadata view already wrote a row to it. This is that
 * read, wired for real.
 */
import 'server-only';

import type { AdminAuditLogEntry, AdminAuditLogQuery } from '@snap/api-contract';

import { adminApi, capabilityGated, type Gated } from './client';

export async function searchAuditLog(query: AdminAuditLogQuery = {}): Promise<Gated<AdminAuditLogEntry[]>> {
  const params = new URLSearchParams();
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.tenantId) params.set('tenantId', query.tenantId);
  if (query.action) params.set('action', query.action);
  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  params.set('limit', String(query.limit ?? 50));
  params.set('offset', String(query.offset ?? 0));

  return capabilityGated(() => adminApi<AdminAuditLogEntry[]>(`/v1/admin/audit-log?${params.toString()}`));
}
