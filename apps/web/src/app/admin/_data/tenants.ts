/**
 * Tenant/workspace data access — platform admin.
 *
 * FIXTURE-BACKED. Reads `../_fixtures/seed.ts` only. The admin backend (a
 * cross-tenant `SECURITY DEFINER` read path per docs/WEB.md §6) is being built
 * in parallel; every function below is written so that swapping the fixture
 * read for `api<T>('/v1/admin/tenants...')` is a change inside this file only
 * — no caller needs to change shape.
 */
import 'server-only';

import type { ConnectionStatus, Workspace } from '@snap/api-contract';

import { FIRMS, TENANTS, USERS, type TenantSeed } from '../_fixtures/seed';

export type TenantStatus = 'active' | 'dormant' | 'suspended';

export type TenantListRow = {
  id: string;
  name: string;
  abn: string;
  kind: Workspace;
  status: TenantStatus;
  firmId: string | null;
  firmName: string | null;
  planCode: string;
  planName: string;
  memberCount: number;
  documents30d: number;
  autoAcceptRate: number;
  needsReviewRate: number;
  errorRate: number;
  mrrCents: number;
  aiCostCents30d: number;
  costRisk: boolean;
  connectionStatus: ConnectionStatus;
};

export type TenantDetail = TenantListRow & {
  gstRegistered: boolean;
  gstBasis: 'cash' | 'accrual';
  gstAtRiskCents: number;
  gstClaimableCents: number;
  storageBytes: number;
  retentionMonths: number;
  scanQuota: number | null;
  scansUsed: number;
  seatLimit: number;
  seatsUsed: number;
  createdAt: string;
  connections: TenantSeed['connections'];
  members: Array<{ userId: string; displayName: string; email: string; role: string }>;
};

export type TenantListParams = {
  query?: string;
  status?: TenantStatus | 'all';
  firmId?: string | 'all' | 'none';
  costRiskOnly?: boolean;
  page?: number;
  pageSize?: number;
};

function firmName(firmId: string | null): string | null {
  return firmId ? (FIRMS.find((f) => f.id === firmId)?.name ?? null) : null;
}

/** Mirrors `v_tenant_cost_vs_price`: real inference spend outrunning the seat price. */
function isCostRisk(t: TenantSeed): boolean {
  return t.aiCostCents30d > t.priceCents * 0.5;
}

function toRow(t: TenantSeed): TenantListRow {
  return {
    id: t.id,
    name: t.name,
    abn: t.abn,
    kind: t.kind,
    status: t.status,
    firmId: t.firmId,
    firmName: firmName(t.firmId),
    planCode: t.planCode,
    planName: t.planName,
    memberCount: t.seatsUsed,
    documents30d: t.documents30d,
    autoAcceptRate: t.autoAcceptRate,
    needsReviewRate: t.needsReviewRate,
    errorRate: t.errorRate,
    mrrCents: t.priceCents,
    aiCostCents30d: t.aiCostCents30d,
    costRisk: isCostRisk(t),
    connectionStatus: t.connections[0]?.status ?? 'disconnected',
  };
}

export async function listTenants(
  params: TenantListParams = {},
): Promise<{ items: TenantListRow[]; total: number }> {
  const { query = '', status = 'all', firmId = 'all', costRiskOnly = false, page = 1, pageSize = 50 } = params;
  const q = query.trim().toLowerCase();
  let rows = TENANTS.map(toRow);
  if (q) {
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.abn.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
    );
  }
  if (status !== 'all') rows = rows.filter((r) => r.status === status);
  if (firmId === 'none') rows = rows.filter((r) => r.firmId === null);
  else if (firmId !== 'all') rows = rows.filter((r) => r.firmId === firmId);
  if (costRiskOnly) rows = rows.filter((r) => r.costRisk);
  rows.sort((a, b) => b.documents30d - a.documents30d);
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total };
}

export async function getTenant(id: string): Promise<TenantDetail | null> {
  const t = TENANTS.find((x) => x.id === id);
  if (!t) return null;
  const members = USERS.filter((u) => u.memberships.some((m) => m.tenantId === id)).map((u) => ({
    userId: u.id,
    displayName: u.displayName,
    email: u.email,
    role: u.memberships.find((m) => m.tenantId === id)!.role,
  }));
  return {
    ...toRow(t),
    gstRegistered: t.gstRegistered,
    gstBasis: t.gstBasis,
    gstAtRiskCents: t.gstAtRiskCents,
    gstClaimableCents: t.gstClaimableCents,
    storageBytes: t.storageBytes,
    retentionMonths: t.retentionMonths,
    scanQuota: t.scanQuota,
    scansUsed: t.scansUsed,
    seatLimit: t.seatLimit,
    seatsUsed: t.seatsUsed,
    createdAt: t.createdAt,
    connections: t.connections,
    members,
  };
}

export type PaletteHit = { id: string; label: string; sublabel: string; href: string };

/** Bounded client-side index for the command palette. Fine at this size —
 * move to a server search endpoint once the tenant count leaves the hundreds. */
export async function searchTenantsForPalette(limit = 200): Promise<PaletteHit[]> {
  return TENANTS.slice(0, limit).map((t) => ({
    id: t.id,
    label: t.name,
    sublabel: `${t.abn} · ${firmName(t.firmId) ?? 'Direct'}`,
    href: `/admin/tenants/${t.id}`,
  }));
}

export function listFirms(): Array<{ id: string; name: string }> {
  return FIRMS.map((f) => ({ id: f.id, name: f.name }));
}
