/**
 * Platform overview data access — the operator metrics, wired to the real
 * admin plane.
 *
 * All three calls require `view_analytics` and are fetched together under one
 * `capabilityGated` — a staff member without the capability gets one refusal
 * for the whole page, not three. See the wiring report for what the previous
 * fixture showed that this has no server backing for at all: firm count,
 * per-user status breakdown, per-tenant cost-vs-price alerts, MRR/ARR, and
 * gross margin (the last one deliberately not computed here — see below).
 */
import 'server-only';

import type { AdminAnalyticsOverview, AdminQueueStat, AdminRetentionStatusRow } from '@snap/api-contract';

import { adminApi, capabilityGated, type Gated } from './client';

export type PlatformOverview = AdminAnalyticsOverview & {
  queue: AdminQueueStat[];
  retention: AdminRetentionStatusRow[];
};

export async function getPlatformOverview(): Promise<Gated<PlatformOverview>> {
  return capabilityGated(async () => {
    const [overview, queue, retention] = await Promise.all([
      adminApi<AdminAnalyticsOverview>('/v1/admin/analytics/overview'),
      adminApi<AdminQueueStat[]>('/v1/admin/operations/queue'),
      adminApi<AdminRetentionStatusRow[]>('/v1/admin/operations/retention'),
    ]);
    return { ...overview, queue, retention };
  });
}
