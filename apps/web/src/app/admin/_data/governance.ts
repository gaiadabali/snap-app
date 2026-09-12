import 'server-only';

import type {
  AdminAiKeyRef,
  AdminAiProviderConfig,
  AdminAiUsageStat,
  AdminJobRef,
  AdminPlatformSetting,
  AdminQueueStat,
  AdminRetentionStatusRow,
  AdminSession,
  PlatformCapability,
} from '@snap/api-contract';

import { adminApi, capabilityGated, type Gated } from './client';

// Re-exported so pages/components under `(governance)/` can type against
// these without every file importing from `@snap/api-contract` directly.
export type {
  AdminAiKeyRef,
  AdminAiProviderConfig,
  AdminAiUsageStat,
  AdminJobRef,
  AdminPlatformSetting,
  AdminQueueStat,
  AdminRetentionStatusRow,
  AdminSession,
  Gated,
  PlatformCapability,
};

/**
 * Platform governance data layer — AI configuration/spend, server operations,
 * platform settings.
 *
 * REAL, on purpose: this used to be a ~1200-line fixture file. The admin
 * backend now exists (`apps/server/src/admin/{ai,settings,operations,
 * analytics}.controller.ts`), and every function below either calls a real
 * endpoint through `adminApi`/`capabilityGated`, or is explicitly documented
 * here as NOT backed by one — see the "NO SERVER ENDPOINT" section at the
 * bottom, which is the exhaustive list.
 *
 * Three rules, non-negotiable per the brief:
 *  1. A missing capability is a normal outcome, not a crash — every read that
 *     hits a `@RequireCapability`d endpoint returns `Gated<T>` so the caller
 *     renders a refusal panel, never a blank table or an error page.
 *  2. Every write carries an `Idempotency-Key`, one per user intent — callers
 *     pass one in (usually `newIdempotencyKey()` from a client component),
 *     never generated per retry.
 *  3. Never invent or estimate a value. Where no endpoint exists, the
 *     function does not exist either — the UI renders a `NotWired` panel
 *     instead of calling something that returns a fabricated number.
 */

// ─────────────────────────────────────────────────────────────────────────
// My own session — replaces the old `currentOperatorLabel()` fixture.
// `GET /v1/admin/me` has no `@RequireCapability`; any signed-in platform
// staff member can see their own role and capabilities. The server attributes
// every write to the caller itself (`CurrentUser()`), so no client-supplied
// "actor" string is needed on any mutation below — unlike the fixture this
// replaces, which had to invent one.
// ─────────────────────────────────────────────────────────────────────────

export async function getMySession(): Promise<AdminSession> {
  return adminApi<AdminSession>('/v1/admin/me');
}

// ─────────────────────────────────────────────────────────────────────────
// AI provider / key configuration — apps/server/src/admin/ai.controller.ts
// Capability: manage_ai_config
// ─────────────────────────────────────────────────────────────────────────

export async function getAiProviders(): Promise<Gated<AdminAiProviderConfig[]>> {
  return capabilityGated(() => adminApi<AdminAiProviderConfig[]>('/v1/admin/ai/providers'));
}

export async function upsertAiProvider(
  input: { provider: string; label: string; defaultModel?: string | null; isActive?: boolean },
  idempotencyKey: string,
): Promise<AdminAiProviderConfig> {
  return adminApi<AdminAiProviderConfig>('/v1/admin/ai/providers', {
    method: 'POST',
    body: input,
    idempotencyKey,
  });
}

/**
 * Sets or rotates a provider's key. The server encrypts it immediately
 * (app-level AEAD, KMS-wrapped DEK) and this response — like every other read
 * of this provider — never carries the plaintext back, only a prefix and
 * last four characters. See `KmsWarning` for the operational caveat on the
 * KMS itself.
 */
export async function setAiProviderKey(
  configId: string,
  apiKey: string,
  idempotencyKey: string,
): Promise<AdminAiKeyRef> {
  return adminApi<AdminAiKeyRef>(`/v1/admin/ai/providers/${encodeURIComponent(configId)}/key`, {
    method: 'POST',
    body: { apiKey },
    idempotencyKey,
  });
}

/**
 * Revokes a stored key by id. NOTE (see the report): `GET
 * /v1/admin/ai/providers` does not return the live key's id, only
 * prefix/last4/hasLiveKey — so the only `keyId` a caller can ever have is the
 * one handed back by `setAiProviderKey` in the same session, immediately
 * after a set/rotate. There is no way to revoke an older key that was set in
 * a previous session from this screen. That is a real gap, not a UI
 * omission — flagged for the next round of server work.
 */
export async function revokeAiKey(
  keyId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ revoked: true }> {
  return adminApi<{ revoked: true }>(`/v1/admin/ai/keys/${encodeURIComponent(keyId)}/revoke`, {
    method: 'POST',
    body: { reason },
    idempotencyKey,
  });
}

export async function getAiUsage(): Promise<Gated<AdminAiUsageStat[]>> {
  return capabilityGated(() => adminApi<AdminAiUsageStat[]>('/v1/admin/ai/usage'));
}

// ─────────────────────────────────────────────────────────────────────────
// Platform settings — apps/server/src/admin/settings.controller.ts
// Capability: manage_platform_settings
//
// The server models this as a flat key/value bag (`AdminPlatformSetting`:
// key, value: unknown, updatedAt) — there is no dedicated schema for feature
// flags, plan defaults, extraction thresholds, validator toggles, maintenance
// mode, announcement banners, or support contact info. Whatever rows
// currently exist under `admin_setting_list()` are shown as-is, generically;
// nothing here presents invented structure (min/max, severity, client
// targeting, …) as if the server modelled it, because it doesn't.
// ─────────────────────────────────────────────────────────────────────────

export async function getPlatformSettings(): Promise<Gated<AdminPlatformSetting[]>> {
  return capabilityGated(() => adminApi<AdminPlatformSetting[]>('/v1/admin/settings'));
}

export async function setPlatformSetting(
  key: string,
  value: unknown,
  reason: string,
  idempotencyKey: string,
): Promise<AdminPlatformSetting> {
  return adminApi<AdminPlatformSetting>(`/v1/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: { value, reason },
    idempotencyKey,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Operations — queue/retention reads live on AdminAnalyticsController
// (capability: view_analytics); the re-extraction trigger lives on
// AdminOperationsController (capability: manage_operations). Two different
// capabilities, so two different refusal panels — a staff member can have
// either without the other.
// ─────────────────────────────────────────────────────────────────────────

export async function getQueueStats(): Promise<Gated<AdminQueueStat[]>> {
  return capabilityGated(() => adminApi<AdminQueueStat[]>('/v1/admin/operations/queue'));
}

export async function getRetentionStatus(): Promise<Gated<AdminRetentionStatusRow[]>> {
  return capabilityGated(() => adminApi<AdminRetentionStatusRow[]>('/v1/admin/operations/retention'));
}

/**
 * Re-queues extraction for exactly ONE capture. This is the entire
 * server-side re-extraction surface — there is no bulk/mass "replay a
 * tenant" or "replay everything a model touched" endpoint, and therefore no
 * way to preview a blast radius for one, because there is no scope larger
 * than a single document to preview. See the report for what the old fixture
 * UI assumed that the server does not actually support.
 */
export async function triggerReextraction(
  tenantId: string,
  captureId: string,
  reason: string,
  idempotencyKey: string,
): Promise<AdminJobRef> {
  return adminApi<AdminJobRef>('/v1/admin/operations/reextraction', {
    method: 'POST',
    body: { tenantId, captureId, reason },
    idempotencyKey,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Model registry — STATIC reference data, not a live read.
//
// Mirrors `apps/server/src/ai/router.ts`'s `MODELS` verbatim (id,
// capabilities, tier, benchmarkScore, medianSeconds, note, excludedFrom).
// There is no admin endpoint that returns this — the web app cannot import
// the server package directly (different app, different deploy) — so this is
// a committed copy, kept in step by hand until `GET /v1/admin/ai/models`
// exists. It is read-only for a second, harder reason beyond "no endpoint to
// read it": even if there were a read endpoint, there is no write endpoint —
// `setPrimaryModel` / `setEscalationOrder` / `setModelEnabled` from the old
// fixture had nothing to persist to and are not reintroduced here.
//
// `computeChain` reimplements `router.ts`'s `chain()` sort (tier, then
// median seconds, excluding anything barred for the capability) over this
// same static data — not a fabricated ordering, the identical deterministic
// function the server itself runs, shown as read-only.
// ─────────────────────────────────────────────────────────────────────────

export type Capability = 'vision' | 'chat';

export type ModelRegistryEntry = {
  id: string;
  capabilities: Capability[];
  tier: 1 | 2 | 3;
  benchmarkScore: number | null;
  medianSeconds: number | null;
  note: string;
  /** Capabilities this model is barred from, each with the documented reason. */
  excludedFrom?: Partial<Record<Capability, string>>;
};

export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    id: 'minimax-m3',
    capabilities: ['vision', 'chat'],
    tier: 1,
    benchmarkScore: 8,
    medianSeconds: 5.39,
    note: 'Primary reader. Perfect on a creased, glare-covered thermal docket.',
  },
  {
    id: 'gemma4:31b',
    capabilities: ['vision', 'chat'],
    tier: 1,
    benchmarkScore: 8,
    medianSeconds: 2.82,
    note: 'Fastest and cheapest at 140 output tokens. Non-Chinese fallback.',
  },
  {
    id: 'kimi-k3',
    capabilities: ['vision', 'chat'],
    tier: 2,
    benchmarkScore: 8,
    medianSeconds: 7.28,
    note: 'Escalation. Same accuracy, slower, different failure modes.',
  },
  {
    id: 'qwen3.5:397b',
    capabilities: ['vision', 'chat'],
    tier: 3,
    benchmarkScore: 8,
    medianSeconds: 23.21,
    note: 'Last resort. Accurate but spends thousands of tokens reasoning.',
  },
  {
    id: 'glm-5.3',
    capabilities: ['chat'],
    tier: 1,
    benchmarkScore: null,
    medianSeconds: 3.4,
    note: 'Chat only — returns 400 for an image. Fast and fluent.',
  },
  {
    id: 'deepseek-v4-flash:0731',
    capabilities: ['chat'],
    tier: 2,
    benchmarkScore: null,
    medianSeconds: 4.4,
    note: 'Chat only. Cheap, and excluded — see excludedFrom.',
    excludedFrom: {
      chat:
        'docs/AI.md §2.3: it called the tools and then failed to report what ' +
        'they returned. A model that ignores the authoritative answer it just ' +
        'requested is worse than one with no tools, because the wrong figure ' +
        'now appears sanctioned. Scored 2/4 with tools where every other ' +
        'candidate scored 4/4.',
    },
  },
];

export function getModelRegistry(): ModelRegistryEntry[] {
  return MODEL_REGISTRY;
}

export type ComputedChain = {
  capability: Capability;
  primary: ModelRegistryEntry | null;
  escalation: ModelRegistryEntry[];
  excluded: Array<{ model: ModelRegistryEntry; reason: string }>;
};

/** Read-only reimplementation of `router.ts`'s `chain()`/`primary()` sort. */
export function computeChain(capability: Capability): ComputedChain {
  const excluded = MODEL_REGISTRY.filter((m) => m.excludedFrom?.[capability]).map((model) => ({
    model,
    reason: model.excludedFrom![capability]!,
  }));
  const eligible = MODEL_REGISTRY.filter(
    (m) => m.capabilities.includes(capability) && !m.excludedFrom?.[capability],
  ).sort((a, b) => a.tier - b.tier || (a.medianSeconds ?? 99) - (b.medianSeconds ?? 99));
  return {
    capability,
    primary: eligible[0] ?? null,
    escalation: eligible.slice(1),
    excluded,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// NO SERVER ENDPOINT — the exhaustive list.
//
// Every one of these existed as a fixture function in this file before this
// build. Checked against `apps/server/src/admin/*.controller.ts` and
// `packages/db/migrations/0021_admin_plane.sql` one at a time; none has a
// route. They are not reintroduced — the corresponding UI either renders a
// `NotWired` panel explaining the gap, or was removed:
//
//  - Model registry mutation: setPrimaryModel, setEscalationOrder,
//    setModelEnabled — no admin endpoint reads OR writes routing/model state;
//    `EXTRACTION_MODEL` is a server env var, not admin-configurable.
//  - AI spend breakdown: getModelSpend (per-model cost share), getTenantSpend
//    (per-tenant inference cost vs seat price), getWeeklySpend (time series),
//    getSpendOverview (platform totals/guardrail) — `GET /v1/admin/ai/usage`
//    returns per-engine/model run counts and cost, but nothing sliced by
//    tenant, nothing as a time series, and no revenue comparison.
//  - Budget caps: getBudgetCaps, setBudgetCap — no budget-cap concept exists
//    server-side at all.
//  - Worker health: getWorkerHealth — no endpoint.
//  - Job failures/retries: getJobFailures, retryFailedJobs — no endpoint.
//  - Retention JOB run history: getRetentionJobs (schedule, last run status,
//    documents purged, next run) — `GET /v1/admin/operations/retention`
//    (wired above, as `getRetentionStatus`) is a different concept: current
//    exposure (oldest document vs retention window) per tenant, not a log of
//    purge job runs.
//  - Manual purge trigger: previewPurge, triggerPurge — no endpoint. Only a
//    read of current retention exposure exists; there is no route to run a
//    purge on demand.
//  - Storage usage: getStorageUsage — no endpoint.
//  - Rate limits: getRateLimits — no endpoint.
//  - Mass re-extraction / replay: previewReplay, triggerReplay (scoped to a
//    tenant / model cohort / the whole platform, with a cost+duration
//    estimate) — `POST /v1/admin/operations/reextraction` (wired above, as
//    `triggerReextraction`) only re-queues ONE capture at a time and has no
//    preview. There is no bulk endpoint and therefore no blast radius to show
//    for one.
//  - Feature flags: getFeatureFlags, setFeatureFlag — no dedicated schema;
//    see the platform-settings note above.
//  - Plan/quota defaults: getPlanDefaults, updatePlanDefault — no endpoint
//    edits a plan catalog; `AdminPlanSummary`/`AdminSetPlanRequest` (a
//    different, real feature owned by the people/tenants surface) assign an
//    EXISTING plan to one tenant, they do not define what a plan code means.
//  - Extraction thresholds: getExtractionThresholds, setExtractionThreshold —
//    no dedicated schema.
//  - Validator toggles: getValidatorToggles, setValidatorToggle — no
//    dedicated schema; validators are code (`apps/server/src/ai/validators`
//    equivalent), not admin-configurable data.
//  - Maintenance mode: getMaintenanceMode, setMaintenanceMode — no dedicated
//    schema.
//  - Announcement banners: getAnnouncementBanners, upsertAnnouncementBanner,
//    removeAnnouncementBanner — no dedicated schema.
//  - Support/contact config: getSupportConfig, updateSupportConfig — no
//    dedicated schema.
//  - Audit log read: getAuditLog — every mutation above is audited
//    server-side (`audit_log` table, per migration 0021), but no controller
//    exposes a GET to read it back. There is no way to show "who did this
//    and when" in this console yet.
//  - Tenant picker fixture: getTenantOptions — used to read `_fixtures/seed.ts`
//    (owned by another agent's surface, not real data). The re-extraction
//    form below takes a tenant id as plain text instead of a picker, which
//    also sidesteps needing `view_tenant_metadata` (a capability this
//    surface's actions do not otherwise require) just to trigger a
//    re-extraction.
// ─────────────────────────────────────────────────────────────────────────
