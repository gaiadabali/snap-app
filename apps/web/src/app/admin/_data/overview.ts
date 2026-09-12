/**
 * Platform overview data access — the operator metrics.
 *
 * FIXTURE-BACKED — see the note at the top of `people.ts`. The unit economics
 * used to derive AI cost and margin come from `docs/MONETISATION.md` §4
 * (~$0.011/scan blended extraction, ~$0.002/scan storage); the tenant-level
 * cost figures live on the seed and are aggregated here, exactly the shape
 * `v_tenant_cost_vs_price` (docs/WEB.md §6, docs/MONETISATION.md §6) would
 * hand back for real.
 */
import 'server-only';

import { FIRMS, TENANTS, USERS } from '../_fixtures/seed';

export type PlatformTotals = {
  totalUsers: number;
  totalTenants: number;
  totalFirms: number;
  activeUsers: number;
  dormantUsers: number;
  suspendedUsers: number;
};

export type ScanHealth = {
  processed30d: number;
  autoAcceptRate: number;
  needsReviewRate: number;
  errorRate: number;
  /** Documents waiting on extraction right now — invented; no queue-depth route yet. */
  queueDepth: number;
};

export type RevenueSnapshot = {
  mrrCents: number;
  arrCents: number;
  aiCostCents30d: number;
  storageCostCents30d: number;
  grossMarginPct: number;
};

export type TenantCostAlert = {
  tenantId: string;
  tenantName: string;
  firmName: string | null;
  planName: string;
  priceCents: number;
  aiCostCents30d: number;
  /** aiCost / price — over ~0.5 means the client's real inference spend is
   * eating the seat's margin fast; over 1.0 means the seat is running at a loss. */
  costToPriceRatio: number;
};

export type PlatformOverview = {
  totals: PlatformTotals;
  scans: ScanHealth;
  revenue: RevenueSnapshot;
  costAlerts: TenantCostAlert[];
};

/** ~$0.011/scan blended (Haiku 4.5 primary, Sonnet 5 escalation) — docs/MONETISATION.md §4. */
const STORAGE_COST_CENTS_PER_SCAN_YR1 = 0.2;

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const totalUsers = USERS.length;
  const activeUsers = USERS.filter((u) => u.status === 'active').length;
  const dormantUsers = USERS.filter((u) => u.status === 'dormant').length;
  const suspendedUsers = USERS.filter((u) => u.status === 'suspended').length;

  const activeTenants = TENANTS.filter((t) => t.status !== 'suspended');
  const processed30d = TENANTS.reduce((sum, t) => sum + t.documents30d, 0);
  const weightedAutoAccept = activeTenants.reduce((sum, t) => sum + t.autoAcceptRate * t.documents30d, 0);
  const weightedNeedsReview = activeTenants.reduce((sum, t) => sum + t.needsReviewRate * t.documents30d, 0);
  const weightedError = activeTenants.reduce((sum, t) => sum + t.errorRate * t.documents30d, 0);
  const totalDocsForRates = activeTenants.reduce((sum, t) => sum + t.documents30d, 0) || 1;

  const mrrCents = TENANTS.reduce((sum, t) => sum + (t.status === 'suspended' ? 0 : t.priceCents), 0);
  const aiCostCents30d = TENANTS.reduce((sum, t) => sum + t.aiCostCents30d, 0);
  const storageCostCents30d = Math.round(processed30d * STORAGE_COST_CENTS_PER_SCAN_YR1);
  const grossMarginPct = mrrCents === 0 ? 0 : ((mrrCents - aiCostCents30d - storageCostCents30d) / mrrCents) * 100;

  const costAlerts: TenantCostAlert[] = TENANTS.filter((t) => t.aiCostCents30d > t.priceCents * 0.5)
    .map((t) => ({
      tenantId: t.id,
      tenantName: t.name,
      firmName: t.firmId ? (FIRMS.find((f) => f.id === t.firmId)?.name ?? null) : null,
      planName: t.planName,
      priceCents: t.priceCents,
      aiCostCents30d: t.aiCostCents30d,
      costToPriceRatio: t.priceCents === 0 ? Infinity : t.aiCostCents30d / t.priceCents,
    }))
    .sort((a, b) => b.costToPriceRatio - a.costToPriceRatio);

  // Queue depth is invented: no BFF endpoint reports it yet. Modelled as
  // "needs_review documents from tenants active in the last 48h", which is a
  // defensible proxy until a real extraction-queue table is exposed.
  const queueDepth = TENANTS.filter((t) => t.status === 'active').reduce(
    (sum, t) => sum + Math.round(t.documents30d * t.needsReviewRate * 0.08),
    0,
  );

  return {
    totals: {
      totalUsers,
      totalTenants: TENANTS.length,
      totalFirms: FIRMS.length,
      activeUsers,
      dormantUsers,
      suspendedUsers,
    },
    scans: {
      processed30d,
      autoAcceptRate: weightedAutoAccept / totalDocsForRates,
      needsReviewRate: weightedNeedsReview / totalDocsForRates,
      errorRate: weightedError / totalDocsForRates,
      queueDepth,
    },
    revenue: {
      mrrCents,
      arrCents: mrrCents * 12,
      aiCostCents30d,
      storageCostCents30d,
      grossMarginPct,
    },
    costAlerts,
  };
}
