/**
 * Tenant/workspace data access — platform admin, wired to the real admin
 * plane.
 *
 * `listTenants`/`getTenant` are backed by `GET /v1/admin/tenants` and
 * `GET /v1/admin/tenants/:tenantId` (`admin_tenant_search` /
 * `admin_tenant_detail`, 0021_admin_plane.sql), gated on
 * `view_tenant_metadata`. `getRetentionStatus` is a second, separately-gated
 * (`view_analytics`) call folded into the detail page only — see the wiring
 * report for the full list of fixture fields with no server backing at all
 * (firm, GST position, storage, per-tenant extraction rates, MRR, AI cost,
 * connections, member list).
 */
import 'server-only';

import type {
  AdminRetentionStatusRow,
  AdminTenantDetail,
  AdminTenantDocumentsView,
  AdminTenantSummary,
} from '@snap/api-contract';

import { adminApi, capabilityGated, readTenantRecords, type Gated } from './client';

export type TenantListParams = { query?: string; page?: number; pageSize?: number };

const MAX_PAGE_SIZE = 100;

export async function listTenants(
  params: TenantListParams = {},
): Promise<Gated<{ items: AdminTenantSummary[]; hasMore: boolean }>> {
  const { query = '', page = 1, pageSize = 50 } = params;
  const limit = Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (page - 1) * limit);
  return capabilityGated(async () => {
    const items = await adminApi<AdminTenantSummary[]>(
      `/v1/admin/tenants?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
    );
    return { items, hasMore: items.length === limit };
  });
}

export async function getTenant(tenantId: string): Promise<Gated<AdminTenantDetail | null>> {
  return capabilityGated(async () => {
    try {
      return await adminApi<AdminTenantDetail>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}`);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  });
}

/**
 * `GET /v1/admin/operations/retention` (`admin_retention_status()`) — one row
 * per tenant that has at least one document, capped at 100 rows, ordered by
 * oldest kept document first. There is no per-tenant retention endpoint, so
 * the detail page fetches the whole list and finds its own row; a tenant with
 * no documents yet, or outside the 100-row window, genuinely has none here —
 * that is a real "not available", not a bug.
 */
export async function getRetentionStatus(): Promise<Gated<AdminRetentionStatusRow[]>> {
  return capabilityGated(() => adminApi<AdminRetentionStatusRow[]>('/v1/admin/operations/retention'));
}

/**
 * A staff read of one tenant's actual documents — `readTenantRecords` from
 * `_data/client.ts`, gated on `read_tenant_records` and audited server-side
 * with the typed `reason`. This is a deliberately separate, occasional action
 * from the ordinary tenant-metadata read above: `view_tenant_metadata` lets a
 * staff member see that a tenant exists and what plan it's on; this is the
 * one that opens actual financial records, and costs a reason every time.
 */
export async function getTenantDocuments(
  tenantId: string,
  reason: string,
): Promise<Gated<AdminTenantDocumentsView>> {
  return capabilityGated(() => readTenantRecords<AdminTenantDocumentsView>(tenantId, reason));
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === 404;
}

export type PaletteHit = { id: string; label: string; sublabel: string; href: string };

/** Bounded client-side index for the command palette — same shape and same
 * caveat as `searchUsersForPalette` in `people.ts`. */
export async function searchTenantsForPalette(limit = 200): Promise<PaletteHit[]> {
  const gated = await capabilityGated(() => adminApi<AdminTenantSummary[]>(`/v1/admin/tenants?limit=${limit}`));
  if (!gated.allowed) return [];
  return gated.data.map((t) => ({
    id: t.tenantId,
    label: t.name,
    sublabel: t.planCode ?? 'No active plan',
    href: `/admin/tenants/${t.tenantId}`,
  }));
}
