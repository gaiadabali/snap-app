import 'server-only';

import { TENANTS } from '../_fixtures/seed';

/**
 * Platform governance data layer — AI configuration/spend, server operations,
 * platform settings.
 *
 * FIXTURE-BACKED, on purpose: the admin backend is being built in parallel by
 * another agent and its endpoints do not exist yet. Every read function below
 * is `async` and every write function is `async` and audited, so the shape at
 * the call site is already what it will be once a real `api()` call replaces
 * the body — swapping the body for `api<T>('/v1/admin/...')` is meant to be a
 * ONE-FILE change, here and only here.
 *
 * Three things are mirrored from the real server rather than invented:
 *  - The model registry mirrors `apps/server/src/ai/router.ts` (`MODELS`).
 *    Capabilities, tiers, benchmark scores and median latencies are the real
 *    measured values from `docs/AI.md`. This file cannot import the server
 *    package directly (different app, different deploy), so it is copied and
 *    must be kept in step until a `/v1/admin/ai/models` endpoint exists.
 *  - Tenant AI spend reuses `_fixtures/seed.ts`'s `TENANTS[].aiCostCents30d`
 *    and `.priceCents` — the same numbers the people/tenants surface reads —
 *    rather than inventing a second, disagreeing set of tenant economics.
 *  - The API key inventory mirrors `apps/server/src/config.ts`'s actual
 *    secret fields (`OLLAMA_API_KEY`) and is honest about the one that is
 *    NOT a UI-settable secret at all (Bedrock: ambient AWS credential chain,
 *    no field in `config.ts`) — see `getApiKeyProviders` below.
 *
 * Nothing here ever stores or returns a raw key. `maskKey` is the only thing
 * allowed to see one, and it returns a prefix and last four characters only,
 * per `docs/WEB.md` §6.
 */

// ─────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────

export type Capability = 'vision' | 'chat';
export type ModelTier = 1 | 2 | 3;
export type ClientTarget = 'mobile' | 'server' | 'website';

export type ModelRegistryEntry = {
  id: string;
  capabilities: Capability[];
  tier: ModelTier;
  benchmarkScore: number | null;
  medianSeconds: number | null;
  note: string;
  enabled: boolean;
  /** Set only when a documented source (AI.md) flags a real concern about this model. */
  caution: string | null;
};

export type CapabilityRouting = {
  capability: Capability;
  primaryModelId: string;
  /** Models to try, in order, after the primary. */
  escalationOrder: string[];
};

export type ApiKeyProvider = {
  id: string;
  label: string;
  description: string;
  usedFor: string;
  /** The `config.ts` field this maps to, or null if there isn't one (no UI secret exists). */
  envVar: string | null;
  /** False means this deliberately has no UI-settable secret — do not offer a form for it. */
  editable: boolean;
  status: 'configured' | 'missing' | 'not_applicable';
  prefix: string | null;
  last4: string | null;
  setAt: string | null;
  setBy: string | null;
  rotatedCount: number;
};

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
};

export type ModelSpend = {
  modelId: string;
  capability: Capability;
  costUsd30d: number;
  calls30d: number;
  tokensIn30d: number;
  tokensOut30d: number;
  /** Share of this model's calls that failed validation and escalated to the next tier. */
  escalationRate: number;
  /** Share of calls served against the cached system prompt (docs/AI.md §2.4). */
  cacheHitRate: number;
};

export type TenantSpend = {
  tenantId: string;
  tenantName: string;
  planCode: string;
  planName: string;
  seatPriceUsd30d: number;
  inferenceCostUsd30d: number;
  documents30d: number;
  /** inferenceCost / seatPrice. Free tier (seatPrice 0) is reported as null, never divided by zero. */
  ratio: number | null;
  flagged: boolean;
};

export type BudgetCap = {
  id: string;
  scope: 'platform' | 'tenant';
  tenantId: string | null;
  tenantName: string | null;
  monthlyCapUsd: number;
  alertThresholdPct: number;
  currentSpendUsd: number;
  status: 'ok' | 'warning' | 'exceeded';
};

export type QueueStats = {
  queue: string;
  label: string;
  depth: number;
  throughputPerMin: number;
  oldestJobAgeSeconds: number;
};

export type WorkerHealth = {
  workerId: string;
  role: string;
  status: 'healthy' | 'degraded' | 'down';
  lastHeartbeatSecondsAgo: number;
  jobsInFlight: number;
  version: string;
};

export type JobFailureBucket = {
  jobType: string;
  label: string;
  failed24h: number;
  retried24h: number;
  succeededAfterRetry24h: number;
  topError: string;
};

export type RetentionJobStatus = {
  id: string;
  name: string;
  schedule: string;
  lastRunAt: string;
  lastRunStatus: 'success' | 'failed' | 'running';
  documentsPurged: number;
  nextRunAt: string;
};

export type StorageUsage = {
  bucket: string;
  label: string;
  bytes: number;
  objectCount: number;
};

export type RateLimitRule = {
  scope: string;
  limit: string;
  currentUsagePct: number;
  tone: 'ok' | 'warn' | 'risk';
};

export type ReplayScope = 'single_tenant' | 'model_cohort' | 'all_tenants';

export type ReplayPreview = {
  scope: ReplayScope;
  tenantId: string | null;
  tenantName: string | null;
  modelId: string | null;
  documentCount: number;
  tenantsAffected: number;
  estimatedCostUsd: number;
  estimatedDurationMinutes: number;
};

export type PurgePreview = {
  documentCount: number;
  tenantsAffected: number;
  oldestRecordAge: string;
};

export type FeatureFlag = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  clients: ClientTarget[];
  takesEffect: string;
  group: 'capture' | 'sync' | 'assistant' | 'billing';
};

export type PlanQuotaDefault = {
  planCode: string;
  planName: string;
  scanQuota: number | null;
  seatLimit: number | null;
  retentionMonths: number;
  priceUsd: number;
};

export type ExtractionThreshold = {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: '%' | 'ratio' | 'days';
  description: string;
  clients: ClientTarget[];
  takesEffect: string;
};

export type ValidatorToggle = {
  key: string;
  label: string;
  enabled: boolean;
  severity: 'blocking' | 'advisory';
  description: string;
};

export type MaintenanceMode = {
  enabled: boolean;
  message: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  clients: ClientTarget[];
};

export type AnnouncementBanner = {
  id: string;
  message: string;
  tone: 'info' | 'warn' | 'risk';
  active: boolean;
  clients: ClientTarget[];
  startsAt: string;
  endsAt: string | null;
};

export type SupportConfig = {
  supportEmail: string;
  statusPageUrl: string;
  responseTimeSla: string;
  escalationPhone: string | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Fixed reference clock — matches `_fixtures/seed.ts` so relative timestamps
// ("3 days ago") do not drift between renders in the same process.
// ─────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-12T09:00:00+10:00');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const SEED_ACTOR = 'priya.nathan@snapapps.internal';

// ─────────────────────────────────────────────────────────────────────────
// Model registry — mirrors apps/server/src/ai/router.ts MODELS verbatim,
// plus the operator-only fields (enabled, caution) that router.ts has no
// reason to carry.
// ─────────────────────────────────────────────────────────────────────────

let models: ModelRegistryEntry[] = [
  {
    id: 'minimax-m3',
    capabilities: ['vision', 'chat'],
    tier: 1,
    benchmarkScore: 8,
    medianSeconds: 5.39,
    note: 'Primary reader. Perfect on a creased, glare-covered thermal docket.',
    enabled: true,
    caution: null,
  },
  {
    id: 'gemma4:31b',
    capabilities: ['vision', 'chat'],
    tier: 1,
    benchmarkScore: 8,
    medianSeconds: 2.82,
    note: 'Fastest and cheapest at 140 output tokens. Non-Chinese fallback.',
    enabled: true,
    caution: null,
  },
  {
    id: 'kimi-k3',
    capabilities: ['vision', 'chat'],
    tier: 2,
    benchmarkScore: 8,
    medianSeconds: 7.28,
    note: 'Escalation. Same accuracy, slower, different failure modes.',
    enabled: true,
    caution: null,
  },
  {
    id: 'qwen3.5:397b',
    capabilities: ['vision', 'chat'],
    tier: 3,
    benchmarkScore: 8,
    medianSeconds: 23.21,
    note: 'Last resort. Accurate but spends thousands of tokens reasoning.',
    enabled: true,
    caution: null,
  },
  {
    id: 'glm-5.3',
    capabilities: ['chat'],
    tier: 1,
    benchmarkScore: null,
    medianSeconds: 3.4,
    note: 'Chat only — returns 400 for an image. Fast and fluent.',
    enabled: true,
    caution: null,
  },
  {
    id: 'deepseek-v4-flash:0731',
    capabilities: ['chat'],
    tier: 2,
    benchmarkScore: null,
    medianSeconds: 4.4,
    note: 'Chat only. Cheap escalation for a long conversation.',
    enabled: true,
    caution:
      'docs/AI.md §2.3: this model called the tools and then failed to report what they returned — ' +
      '"a model that ignores the authoritative answer it just requested is worse than one with no ' +
      'tools." It is EXCLUDED from chat in the documented decision, but still present here in ' +
      'router.ts and enabled. Consider disabling it for the chat capability.',
  },
];

/**
 * Routing config. `EXTRACTION_MODEL` in `apps/server/src/config.ts` currently
 * defaults to `gemma4:31b`, not `minimax-m3` — the deployed pin and the
 * documented decision (docs/AI.md §2.1: "minimax-m3 primary") disagree. This
 * console shows the documented decision as the routing table; changing
 * "primary" here is what would update that pin once this is wired to a real
 * endpoint. Surfacing that gap is deliberate, not a mistake to quietly fix.
 */
let routing: Record<Capability, CapabilityRouting> = {
  vision: {
    capability: 'vision',
    primaryModelId: 'minimax-m3',
    escalationOrder: ['kimi-k3', 'gemma4:31b', 'qwen3.5:397b'],
  },
  chat: {
    capability: 'chat',
    primaryModelId: 'glm-5.3',
    escalationOrder: ['deepseek-v4-flash:0731'],
  },
};

// ─────────────────────────────────────────────────────────────────────────
// API keys — mirrors config.ts's actual secret fields. Bedrock is honestly
// represented as NOT a UI-settable secret (see file header).
// ─────────────────────────────────────────────────────────────────────────

let apiKeys: ApiKeyProvider[] = [
  {
    id: 'ollama_cloud',
    label: 'Ollama Cloud',
    description: 'OpenAI-compatible endpoint serving the capability router models above.',
    usedFor:
      'Development and staging inference for every model in the registry above. Shared across ' +
      'projects and weekly-rate-limited — docs/AI.md §2.6 is explicit it must not become a ' +
      'production dependency.',
    envVar: 'OLLAMA_API_KEY',
    editable: true,
    status: 'configured',
    prefix: 'sk-oll-4f2c',
    last4: '9a3d',
    setAt: daysAgo(46),
    setBy: SEED_ACTOR,
    rotatedCount: 2,
  },
  {
    id: 'bedrock_aws',
    label: 'AWS Bedrock (ap-southeast-2)',
    description: 'Production inference — BedrockClaudeProvider, decision D13.',
    usedFor:
      'Production Claude inference so records never leave Australia (APP 8). ' +
      'BedrockClaudeProvider throws rather than falling back to the dev provider if this is ' +
      'unavailable — a pipeline that quietly ships tax records offshore is the exact failure APP 8 ' +
      'exists to prevent.',
    envVar: null,
    editable: false,
    status: 'not_applicable',
    prefix: null,
    last4: null,
    setAt: null,
    setBy: null,
    rotatedCount: 0,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Audit log — shared by every mutation below.
// ─────────────────────────────────────────────────────────────────────────

let auditLog: AuditEvent[] = [
  {
    id: 'aud_1',
    at: daysAgo(46),
    actor: SEED_ACTOR,
    action: 'ai_key.set',
    detail: 'Set the Ollama Cloud key (sk-oll-4f2c…9a3d).',
  },
  {
    id: 'aud_2',
    at: daysAgo(12),
    actor: SEED_ACTOR,
    action: 'ai_key.rotate',
    detail: 'Rotated the Ollama Cloud key (sk-oll-4f2c…9a3d → new value, prefix unchanged by chance).',
  },
  {
    id: 'aud_3',
    at: daysAgo(9),
    actor: SEED_ACTOR,
    action: 'routing.escalation_reordered',
    detail: 'Vision escalation order changed: [kimi-k3, qwen3.5:397b] → [kimi-k3, gemma4:31b, qwen3.5:397b].',
  },
  {
    id: 'aud_4',
    at: daysAgo(3),
    actor: SEED_ACTOR,
    action: 'flag.toggled',
    detail: 'Enabled feature flag "xero_sync_realtime" for mobile + server.',
  },
  {
    id: 'aud_5',
    at: hoursAgo(19),
    actor: SEED_ACTOR,
    action: 'retention.purge_run',
    detail: 'Nightly ATO 5-year retention purge completed: 0 documents past retention.',
  },
];

function pushAudit(action: string, detail: string, actor: string): AuditEvent {
  const event: AuditEvent = { id: `aud_${auditLog.length + 1}`, at: new Date().toISOString(), actor, action, detail };
  auditLog = [event, ...auditLog];
  return event;
}

// ─────────────────────────────────────────────────────────────────────────
// Usage & spend — decomposes the SAME total the people/tenants surface
// shows (`TENANTS[].aiCostCents30d`), so the two views can never disagree
// about how much was spent, only about how it is sliced.
// ─────────────────────────────────────────────────────────────────────────

const TOTAL_AI_COST_CENTS_30D = TENANTS.reduce((sum, t) => sum + t.aiCostCents30d, 0);
const TOTAL_SEAT_REVENUE_CENTS_30D = TENANTS.reduce((sum, t) => sum + t.priceCents, 0);

/** Illustrative decomposition of the platform total across the registry above. Sums to 1. */
const MODEL_SPEND_SHARE: Record<string, number> = {
  'minimax-m3': 0.58,
  'kimi-k3': 0.14,
  'gemma4:31b': 0.06,
  'qwen3.5:397b': 0.04,
  'glm-5.3': 0.15,
  'deepseek-v4-flash:0731': 0.03,
};

const MODEL_CALL_SHARE: Record<string, number> = {
  'minimax-m3': 0.44,
  'kimi-k3': 0.08,
  'gemma4:31b': 0.1,
  'qwen3.5:397b': 0.01,
  'glm-5.3': 0.32,
  'deepseek-v4-flash:0731': 0.05,
};

const TOTAL_CALLS_30D = 96_400;

function modelSpend(): ModelSpend[] {
  return models.map((m) => {
    const capability: Capability = m.capabilities.includes('vision') ? 'vision' : 'chat';
    const share = MODEL_SPEND_SHARE[m.id] ?? 0;
    const callShare = MODEL_CALL_SHARE[m.id] ?? 0;
    const calls30d = Math.round(TOTAL_CALLS_30D * callShare);
    const outTokensPerCall = m.id === 'gemma4:31b' ? 140 : m.id === 'qwen3.5:397b' ? 2300 : 420;
    return {
      modelId: m.id,
      capability,
      costUsd30d: Math.round((TOTAL_AI_COST_CENTS_30D / 100) * share * 100) / 100,
      calls30d,
      tokensIn30d: calls30d * 1_100,
      tokensOut30d: calls30d * outTokensPerCall,
      escalationRate: m.tier === 3 ? 0 : m.tier === 1 ? 0.07 : 0.31,
      cacheHitRate: m.id === 'qwen3.5:397b' ? 0.4 : 0.89,
    };
  });
}

function tenantSpend(): TenantSpend[] {
  return TENANTS.map((t) => {
    const seatPriceUsd30d = t.priceCents / 100;
    const inferenceCostUsd30d = t.aiCostCents30d / 100;
    const ratio = seatPriceUsd30d > 0 ? inferenceCostUsd30d / seatPriceUsd30d : null;
    return {
      tenantId: t.id,
      tenantName: t.name,
      planCode: t.planCode,
      planName: t.planName,
      seatPriceUsd30d,
      inferenceCostUsd30d,
      documents30d: t.documents30d,
      ratio,
      flagged: ratio !== null && ratio >= 0.8,
    };
  }).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
}

let budgetCaps: BudgetCap[] = [
  {
    id: 'cap_platform',
    scope: 'platform',
    tenantId: null,
    tenantName: null,
    monthlyCapUsd: 400,
    alertThresholdPct: 80,
    currentSpendUsd: Math.round(TOTAL_AI_COST_CENTS_30D) / 100,
    status: 'ok',
  },
  {
    id: 'cap_kalgoorlie',
    scope: 'tenant',
    tenantId: 'ten_kalgoorlie_civil',
    tenantName: 'Kalgoorlie Civil & Earthworks',
    monthlyCapUsd: 70,
    alertThresholdPct: 80,
    currentSpendUsd: 84.2,
    status: 'exceeded',
  },
  {
    id: 'cap_ridgeline',
    scope: 'tenant',
    tenantId: 'ten_ridgeline_roofing',
    tenantName: 'Ridgeline Roofing',
    monthlyCapUsd: 60,
    alertThresholdPct: 80,
    currentSpendUsd: 68.7,
    status: 'exceeded',
  },
  {
    id: 'cap_ironbark_transport',
    scope: 'tenant',
    tenantId: 'ten_ironbark_transport',
    tenantName: 'Ironbark Freight & Transport',
    monthlyCapUsd: 35,
    alertThresholdPct: 80,
    currentSpendUsd: 38.6,
    status: 'exceeded',
  },
  {
    id: 'cap_stringybark',
    scope: 'tenant',
    tenantId: 'ten_stringybark_fencing',
    tenantName: 'Stringybark Fencing & Rural Supplies',
    monthlyCapUsd: 35,
    alertThresholdPct: 80,
    currentSpendUsd: 29.4,
    status: 'warning',
  },
];

function recomputeCapStatus(cap: BudgetCap): BudgetCap {
  const status: BudgetCap['status'] =
    cap.currentSpendUsd >= cap.monthlyCapUsd
      ? 'exceeded'
      : cap.currentSpendUsd >= cap.monthlyCapUsd * (cap.alertThresholdPct / 100)
        ? 'warning'
        : 'ok';
  return { ...cap, status };
}

// ─────────────────────────────────────────────────────────────────────────
// Server operations
// ─────────────────────────────────────────────────────────────────────────

const WEBHOOK_QUEUE_DEPTH = TENANTS.reduce(
  (sum, t) => sum + t.connections.reduce((s, c) => s + c.queued, 0),
  0,
);

const queueStats: QueueStats[] = [
  { queue: 'extraction', label: 'Extraction', depth: 84, throughputPerMin: 12.4, oldestJobAgeSeconds: 340 },
  { queue: 'shadow_ocr', label: 'Shadow OCR (phase1b)', depth: 12, throughputPerMin: 3.1, oldestJobAgeSeconds: 900 },
  {
    queue: 'xero_sync',
    label: 'Accounting-software sync',
    depth: WEBHOOK_QUEUE_DEPTH,
    throughputPerMin: 4.2,
    oldestJobAgeSeconds: 950_400, // ~11 days — matches Kalgoorlie's stalled connection below
  },
  { queue: 'tax_pack_export', label: 'Tax-pack export', depth: 3, throughputPerMin: 0.8, oldestJobAgeSeconds: 120 },
  { queue: 'retention_purge', label: 'Retention purge', depth: 1, throughputPerMin: 0.1, oldestJobAgeSeconds: 3_600 },
];

const workerHealth: WorkerHealth[] = [
  { workerId: 'worker-extraction-1', role: 'extraction', status: 'healthy', lastHeartbeatSecondsAgo: 8, jobsInFlight: 3, version: 'v0.14.2' },
  { workerId: 'worker-extraction-2', role: 'extraction', status: 'healthy', lastHeartbeatSecondsAgo: 11, jobsInFlight: 2, version: 'v0.14.2' },
  { workerId: 'worker-extraction-3', role: 'extraction', status: 'degraded', lastHeartbeatSecondsAgo: 94, jobsInFlight: 6, version: 'v0.14.1' },
  { workerId: 'worker-shadow-ocr-1', role: 'shadow_ocr', status: 'healthy', lastHeartbeatSecondsAgo: 22, jobsInFlight: 1, version: 'v0.14.2' },
  { workerId: 'worker-retention-1', role: 'retention', status: 'healthy', lastHeartbeatSecondsAgo: 240, jobsInFlight: 0, version: 'v0.14.2' },
];

const jobFailures: JobFailureBucket[] = [
  {
    jobType: 'extraction',
    label: 'Extraction',
    failed24h: 14,
    retried24h: 14,
    succeededAfterRetry24h: 11,
    topError: 'Provider timeout after 30s escalating to qwen3.5:397b',
  },
  {
    jobType: 'shadow_ocr',
    label: 'Shadow OCR',
    failed24h: 6,
    retried24h: 0,
    succeededAfterRetry24h: 0,
    topError: 'DOCAI sidecar exceeded 120s whole-stage budget (2-page PDF)',
  },
  {
    jobType: 'xero_sync',
    label: 'Accounting-software sync',
    failed24h: 96,
    retried24h: 40,
    succeededAfterRetry24h: 0,
    topError: 'Xero OAuth token expired mid-sync (Kalgoorlie Civil & Earthworks)',
  },
  {
    jobType: 'tax_pack_export',
    label: 'Tax-pack export',
    failed24h: 1,
    retried24h: 1,
    succeededAfterRetry24h: 1,
    topError: 'Download token expired before the zip finished assembling',
  },
];

let retentionJobs: RetentionJobStatus[] = [
  {
    id: 'retention_5yr',
    name: 'ATO 5-year retention purge',
    schedule: 'Nightly 02:00 Australia/Sydney',
    lastRunAt: hoursAgo(19),
    lastRunStatus: 'success',
    documentsPurged: 0,
    nextRunAt: hoursAgo(-5),
  },
  {
    id: 'retention_free_12mo',
    name: 'Free-tier 12-month retention purge',
    schedule: 'Nightly 02:15 Australia/Sydney',
    lastRunAt: hoursAgo(19),
    lastRunStatus: 'success',
    documentsPurged: 3,
    nextRunAt: hoursAgo(-5),
  },
];

const TOTAL_STORAGE_BYTES = TENANTS.reduce((sum, t) => sum + t.storageBytes, 0);

const storageUsage: StorageUsage[] = [
  { bucket: 'captures-original', label: 'Original captures', bytes: TOTAL_STORAGE_BYTES, objectCount: 48_210 },
  { bucket: 'tax-pack-exports', label: 'Assembled tax-pack exports', bytes: 6_800_000_000, objectCount: 412 },
  { bucket: 'shadow-ocr-artifacts', label: 'Shadow OCR layouts (phase1b)', bytes: 940_000_000, objectCount: 9_880 },
];

const rateLimits: RateLimitRule[] = [
  { scope: 'Ollama Cloud (shared, weekly cap)', limit: 'Weekly token quota', currentUsagePct: 62, tone: 'ok' },
  { scope: 'POST /v1/captures (per tenant)', limit: '120 requests/min', currentUsagePct: 18, tone: 'ok' },
  { scope: 'GET /v1/images/:token (signed URL mint)', limit: '600 requests/min', currentUsagePct: 41, tone: 'ok' },
  { scope: 'Xero API (per connected organisation)', limit: '60 requests/min, 5000/day', currentUsagePct: 88, tone: 'warn' },
];

// ─────────────────────────────────────────────────────────────────────────
// Platform settings
// ─────────────────────────────────────────────────────────────────────────

let featureFlags: FeatureFlag[] = [
  {
    key: 'xero_sync_realtime',
    label: 'Real-time Xero sync',
    description: 'Push a confirmed bill to Xero as soon as it is posted, instead of the nightly batch.',
    enabled: true,
    clients: ['server', 'website'],
    takesEffect: 'Immediately — read on every sync tick',
    group: 'sync',
  },
  {
    key: 'shadow_ocr_stage',
    label: 'Shadow OCR stage (phase1b)',
    description: 'Run PP-OCRv5 alongside VLM extraction for comparison. Never blocks the pipeline.',
    enabled: true,
    clients: ['server'],
    takesEffect: 'Immediately — gated by DOCAI_SIDECAR_URL being set',
    group: 'capture',
  },
  {
    key: 'multi_page_capture',
    label: 'Multi-page capture',
    description: 'Allow a document to span more than one photographed page (phase0-multipage).',
    enabled: true,
    clients: ['mobile', 'server'],
    takesEffect: 'Next mobile build',
    group: 'capture',
  },
  {
    key: 'assistant_tool_calling',
    label: 'Assistant tool calling',
    description: 'Chat assistant answers money questions only via src/ai/tools.ts, never from memory.',
    enabled: true,
    clients: ['mobile', 'website', 'server'],
    takesEffect: 'Immediately',
    group: 'assistant',
  },
  {
    key: 'practice_topup_offer',
    label: 'Practice quota top-up offer',
    description: 'Offer a top-up instead of a refused scan once a firm exhausts its quota (never drop a capture).',
    enabled: true,
    clients: ['website', 'server'],
    takesEffect: 'Immediately',
    group: 'billing',
  },
  {
    key: 'advisor_directory_cta',
    label: 'Xero Advisor Directory call-to-action',
    description: 'Show the "ask your advisor to recommend us" banner on the direct-plan dashboard.',
    enabled: false,
    clients: ['website'],
    takesEffect: 'Immediately',
    group: 'billing',
  },
];

let planDefaults: PlanQuotaDefault[] = [
  { planCode: 'free', planName: 'Free', scanQuota: 20, seatLimit: 1, retentionMonths: 12, priceUsd: 0 },
  { planCode: 'sole_trader', planName: 'Sole Trader', scanQuota: 150, seatLimit: 1, retentionMonths: 60, priceUsd: 29 },
  { planCode: 'practice', planName: 'Practice', scanQuota: 200, seatLimit: 3, retentionMonths: 60, priceUsd: 19 },
  { planCode: 'practice_plus', planName: 'Practice Plus', scanQuota: 600, seatLimit: 8, retentionMonths: 60, priceUsd: 29 },
];

let extractionThresholds: ExtractionThreshold[] = [
  {
    key: 'auto_accept_confidence',
    label: 'Auto-accept confidence bar',
    value: 0.95,
    min: 0.8,
    max: 0.99,
    step: 0.01,
    unit: 'ratio',
    description:
      'Every field must be at or above this AND every validator must pass before a document is auto-accepted (docs/PLAN.md §4). Otherwise it goes to needs_review.',
    clients: ['server'],
    takesEffect: 'Next extraction run — not retroactive',
  },
  {
    key: 'phash_duplicate_distance',
    label: 'Perceptual-hash duplicate distance',
    value: 6,
    min: 0,
    max: 16,
    step: 1,
    unit: 'ratio',
    description: 'Hamming distance at or below this soft-flags a capture as a possible duplicate.',
    clients: ['server'],
    takesEffect: 'Next capture',
  },
  {
    key: 'cash_rounding_tolerance',
    label: 'Cash-rounding tolerance',
    value: 0.02,
    min: 0,
    max: 0.05,
    step: 0.01,
    unit: 'ratio',
    description: 'AU rounds cash to 5c — difference beyond this is not treated as rounding.',
    clients: ['server'],
    takesEffect: 'Next extraction run',
  },
];

let validatorToggles: ValidatorToggle[] = [
  { key: 'abn_checksum', label: 'ABN format (mod-89 checksum)', enabled: true, severity: 'blocking', description: 'Fails ⇒ store but flag abn_valid = false, never verified.' },
  { key: 'abn_identity', label: 'ABN identity (ABR Lookup)', enabled: true, severity: 'advisory', description: 'Confirms legal name and GST registration status.' },
  { key: 'gst_arithmetic', label: 'GST arithmetic', enabled: true, severity: 'blocking', description: 'tax_exclusive_amount + tax_amount == tax_inclusive_amount' },
  { key: 'gst_rate', label: 'GST rate (1/11)', enabled: true, severity: 'blocking', description: 'All-taxable document ⇒ tax_amount ≈ tax_inclusive_amount / 11' },
  { key: 'line_sum', label: 'Line-item sum', enabled: true, severity: 'blocking', description: 'Σ line_net_amount == line_extension_amount' },
  { key: 'mixed_tax_subtotals', label: 'Mixed-tax subtotal reconciliation', enabled: true, severity: 'blocking', description: 'document_tax_subtotals must reconcile per category, not just in total.' },
  { key: 'ato_completeness', label: 'ATO tax-invoice completeness', enabled: true, severity: 'blocking', description: 'Sets is_tax_invoice, which gates GST credit claims.' },
  { key: 'date_sanity', label: 'Date sanity', enabled: true, severity: 'advisory', description: 'issue_date not in the future, not more than 10 years past.' },
];

let maintenanceMode: MaintenanceMode = {
  enabled: false,
  message: 'Snap Apps is undergoing scheduled maintenance. Capture is paused; nothing is lost.',
  scheduledStart: null,
  scheduledEnd: null,
  clients: ['mobile', 'website'],
};

let announcementBanners: AnnouncementBanner[] = [
  {
    id: 'ban_xero_advisor',
    message: 'New: recommend Snap Apps to a client directly from the Xero Advisor Directory.',
    tone: 'info',
    active: true,
    clients: ['website'],
    startsAt: daysAgo(5),
    endsAt: null,
  },
  {
    id: 'ban_kalgoorlie_sync',
    message: 'Xero sync is degraded for some Practice Plus tenants while a token-refresh fix rolls out.',
    tone: 'warn',
    active: true,
    clients: ['website', 'mobile'],
    startsAt: daysAgo(1),
    endsAt: null,
  },
];

let supportConfig: SupportConfig = {
  supportEmail: 'support@snapapps.com.au',
  statusPageUrl: 'https://status.snapapps.com.au',
  responseTimeSla: 'Practice: 4 business hours · Direct: 1 business day',
  escalationPhone: '+61 2 8000 1234',
};

// ─────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────

export async function getModelRegistry(): Promise<ModelRegistryEntry[]> {
  return models;
}

export async function getRouting(): Promise<Record<Capability, CapabilityRouting>> {
  return routing;
}

export async function getApiKeyProviders(): Promise<ApiKeyProvider[]> {
  return apiKeys;
}

export async function getModelSpend(): Promise<ModelSpend[]> {
  return modelSpend();
}

export async function getTenantSpend(): Promise<TenantSpend[]> {
  return tenantSpend();
}

export type WeeklySpendPoint = { weekStart: string; costUsd: number };

/**
 * Last 8 weeks of platform AI spend, trending to the current 30-day total.
 * Illustrative — no time-series endpoint exists yet — but anchored to the
 * same total everything else on this page uses, not an independent guess.
 */
export async function getWeeklySpend(): Promise<WeeklySpendPoint[]> {
  const currentWeeklyUsd = TOTAL_AI_COST_CENTS_30D / 100 / 4.33;
  // A gentle upward trend ending at this week's figure — extraction volume
  // grows with tenant count, which has grown steadily (see createdAt spread
  // in _fixtures/seed.ts).
  const shape = [0.62, 0.68, 0.71, 0.79, 0.83, 0.9, 0.96, 1.0];
  return shape.map((factor, i) => ({
    weekStart: daysAgo((7 - i) * 7).slice(0, 10),
    costUsd: Math.round(currentWeeklyUsd * factor * 100) / 100,
  }));
}

export async function getSpendOverview(): Promise<{
  totalCostUsd30d: number;
  totalSeatRevenueUsd30d: number;
  revenueSharePct: number;
  flaggedTenantCount: number;
}> {
  const flaggedTenantCount = tenantSpend().filter((t) => t.flagged).length;
  return {
    totalCostUsd30d: TOTAL_AI_COST_CENTS_30D / 100,
    totalSeatRevenueUsd30d: TOTAL_SEAT_REVENUE_CENTS_30D / 100,
    revenueSharePct: (TOTAL_AI_COST_CENTS_30D / TOTAL_SEAT_REVENUE_CENTS_30D) * 100,
    flaggedTenantCount,
  };
}

export async function getBudgetCaps(): Promise<BudgetCap[]> {
  return budgetCaps.map(recomputeCapStatus);
}

export async function getQueueStats(): Promise<QueueStats[]> {
  return queueStats;
}

export async function getWorkerHealth(): Promise<WorkerHealth[]> {
  return workerHealth;
}

export async function getJobFailures(): Promise<JobFailureBucket[]> {
  return jobFailures;
}

export async function getRetentionJobs(): Promise<RetentionJobStatus[]> {
  return retentionJobs;
}

export async function getStorageUsage(): Promise<StorageUsage[]> {
  return storageUsage;
}

export async function getRateLimits(): Promise<RateLimitRule[]> {
  return rateLimits;
}

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  return featureFlags;
}

export async function getPlanDefaults(): Promise<PlanQuotaDefault[]> {
  return planDefaults;
}

export async function getExtractionThresholds(): Promise<ExtractionThreshold[]> {
  return extractionThresholds;
}

export async function getValidatorToggles(): Promise<ValidatorToggle[]> {
  return validatorToggles;
}

export async function getMaintenanceMode(): Promise<MaintenanceMode> {
  return maintenanceMode;
}

export async function getAnnouncementBanners(): Promise<AnnouncementBanner[]> {
  return announcementBanners;
}

export async function getSupportConfig(): Promise<SupportConfig> {
  return supportConfig;
}

export async function getAuditLog(limit = 20): Promise<AuditEvent[]> {
  return auditLog.slice(0, limit);
}

/** Id + name only — enough for a scope picker, nothing the (people) surface owns. */
export async function getTenantOptions(): Promise<Array<{ id: string; name: string }>> {
  return TENANTS.map((t) => ({ id: t.id, name: t.name }));
}

/** For replay-blast-radius previews. Deliberately not exported as a mutation — pure calculation. */
export async function previewReplay(
  scope: ReplayScope,
  opts: { tenantId?: string; modelId?: string } = {},
): Promise<ReplayPreview> {
  const perDocCostUsd = 0.006; // gemma4:31b-class cost, the cheap re-reader
  if (scope === 'single_tenant') {
    const tenant = TENANTS.find((t) => t.id === opts.tenantId);
    const documentCount = tenant ? Math.round(tenant.documents30d * 11) : 0; // ~11 months on file
    return {
      scope,
      tenantId: tenant?.id ?? null,
      tenantName: tenant?.name ?? null,
      modelId: opts.modelId ?? null,
      documentCount,
      tenantsAffected: tenant ? 1 : 0,
      estimatedCostUsd: Math.round(documentCount * perDocCostUsd * 100) / 100,
      estimatedDurationMinutes: Math.round(documentCount / 40),
    };
  }
  if (scope === 'model_cohort') {
    const documentCount = 6_200; // documents originally extracted by the named model
    return {
      scope,
      tenantId: null,
      tenantName: null,
      modelId: opts.modelId ?? null,
      documentCount,
      tenantsAffected: 9,
      estimatedCostUsd: Math.round(documentCount * perDocCostUsd * 100) / 100,
      estimatedDurationMinutes: Math.round(documentCount / 40),
    };
  }
  const documentCount = TENANTS.reduce((sum, t) => sum + Math.round(t.documents30d * 11), 0);
  return {
    scope,
    tenantId: null,
    tenantName: null,
    modelId: opts.modelId ?? null,
    documentCount,
    tenantsAffected: TENANTS.length,
    estimatedCostUsd: Math.round(documentCount * perDocCostUsd * 100) / 100,
    estimatedDurationMinutes: Math.round(documentCount / 40),
  };
}

export async function previewPurge(): Promise<PurgePreview> {
  // The purge is due to run and find nothing — retention is 5 years (60mo) or
  // 12mo for free tier, and the oldest tenant on file is ~1400 days (~3.8yr).
  return { documentCount: 0, tenantsAffected: 0, oldestRecordAge: '3 years, 10 months' };
}

// ─────────────────────────────────────────────────────────────────────────
// Mutations — every one is audited. `actor` is a placeholder for the real
// staff identity docs/WEB.md §6 requires (a separate identity table, its own
// audit trail) — this console has no auth wiring yet, so it is passed
// explicitly from the calling server action rather than invented here.
// ─────────────────────────────────────────────────────────────────────────

export async function setPrimaryModel(capability: Capability, modelId: string, actor: string): Promise<void> {
  const model = models.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!model.capabilities.includes(capability)) throw new Error(`${modelId} cannot do ${capability}.`);
  if (!model.enabled) throw new Error(`${modelId} is disabled — enable it before making it primary.`);
  const previous = routing[capability].primaryModelId;
  routing = {
    ...routing,
    [capability]: {
      ...routing[capability],
      primaryModelId: modelId,
      escalationOrder: routing[capability].escalationOrder.filter((id) => id !== modelId),
    },
  };
  pushAudit(
    'routing.primary_changed',
    `${capability} primary model changed: ${previous} → ${modelId}.`,
    actor,
  );
}

export async function setEscalationOrder(capability: Capability, orderedModelIds: string[], actor: string): Promise<void> {
  const previous = routing[capability].escalationOrder;
  routing = { ...routing, [capability]: { ...routing[capability], escalationOrder: orderedModelIds } };
  pushAudit(
    'routing.escalation_reordered',
    `${capability} escalation order changed: [${previous.join(', ')}] → [${orderedModelIds.join(', ')}].`,
    actor,
  );
}

export async function setModelEnabled(modelId: string, enabled: boolean, actor: string): Promise<void> {
  const model = models.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  for (const cap of model.capabilities) {
    if (!enabled && routing[cap].primaryModelId === modelId) {
      throw new Error(`${modelId} is the primary ${cap} model — change the primary before disabling it.`);
    }
  }
  models = models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
  if (!enabled) {
    routing = Object.fromEntries(
      Object.entries(routing).map(([cap, r]) => [cap, { ...r, escalationOrder: r.escalationOrder.filter((id) => id !== modelId) }]),
    ) as Record<Capability, CapabilityRouting>;
  }
  pushAudit('model.toggled', `${modelId} ${enabled ? 'enabled' : 'disabled'}.`, actor);
}

function maskKey(raw: string): { prefix: string; last4: string } {
  const trimmed = raw.trim();
  return { prefix: trimmed.slice(0, 8), last4: trimmed.slice(-4) };
}

export async function setApiKey(providerId: string, rawKey: string, actor: string): Promise<void> {
  const provider = apiKeys.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Unknown key provider: ${providerId}`);
  if (!provider.editable) throw new Error(`${provider.label} has no UI-settable key — see its description.`);
  if (rawKey.trim().length < 12) throw new Error('That does not look like a real key (too short).');
  const wasConfigured = provider.status === 'configured';
  const { prefix, last4 } = maskKey(rawKey);
  apiKeys = apiKeys.map((p) =>
    p.id === providerId
      ? { ...p, status: 'configured', prefix, last4, setAt: new Date().toISOString(), setBy: actor, rotatedCount: wasConfigured ? p.rotatedCount + 1 : p.rotatedCount }
      : p,
  );
  pushAudit(
    wasConfigured ? 'ai_key.rotate' : 'ai_key.set',
    `${wasConfigured ? 'Rotated' : 'Set'} the ${provider.label} key (${prefix}…${last4}). The raw value was never stored or logged.`,
    actor,
  );
  // rawKey is intentionally never referenced again after this point.
}

export async function triggerReplay(
  scope: ReplayScope,
  opts: { tenantId?: string; modelId?: string },
  confirmationPhrase: string,
  actor: string,
): Promise<{ jobId: string }> {
  if (confirmationPhrase !== 'REPLAY') throw new Error('Type REPLAY to confirm.');
  const preview = await previewReplay(scope, opts);
  pushAudit(
    'extraction.replay_triggered',
    `Re-extraction triggered (${scope}): ${preview.documentCount.toLocaleString('en-AU')} documents across ${preview.tenantsAffected} tenant(s), est. $${preview.estimatedCostUsd.toFixed(2)}.`,
    actor,
  );
  return { jobId: `replay_${Date.now()}` };
}

export async function triggerPurge(confirmationPhrase: string, actor: string): Promise<{ jobId: string }> {
  if (confirmationPhrase !== 'PURGE') throw new Error('Type PURGE to confirm.');
  const preview = await previewPurge();
  pushAudit(
    'retention.purge_triggered',
    `Manual retention purge triggered: ${preview.documentCount} documents, ${preview.tenantsAffected} tenant(s).`,
    actor,
  );
  return { jobId: `purge_${Date.now()}` };
}

export async function retryFailedJobs(jobType: string, actor: string): Promise<void> {
  const bucket = jobFailures.find((j) => j.jobType === jobType);
  if (!bucket) throw new Error(`Unknown job type: ${jobType}`);
  pushAudit('jobs.retry_triggered', `Retried ${bucket.failed24h} failed "${bucket.label}" jobs from the last 24h.`, actor);
}

export async function setBudgetCap(
  id: string,
  patch: { monthlyCapUsd: number; alertThresholdPct: number },
  actor: string,
): Promise<void> {
  const cap = budgetCaps.find((c) => c.id === id);
  if (!cap) throw new Error(`Unknown budget cap: ${id}`);
  budgetCaps = budgetCaps.map((c) => (c.id === id ? recomputeCapStatus({ ...c, ...patch }) : c));
  pushAudit(
    'budget_cap.updated',
    `Budget cap for ${cap.tenantName ?? 'the platform'} set to $${patch.monthlyCapUsd}/mo, alert at ${patch.alertThresholdPct}%.`,
    actor,
  );
}

export async function setFeatureFlag(key: string, enabled: boolean, actor: string): Promise<void> {
  const flag = featureFlags.find((f) => f.key === key);
  if (!flag) throw new Error(`Unknown flag: ${key}`);
  featureFlags = featureFlags.map((f) => (f.key === key ? { ...f, enabled } : f));
  pushAudit('flag.toggled', `Feature flag "${flag.label}" ${enabled ? 'enabled' : 'disabled'} (${flag.clients.join(', ')}).`, actor);
}

export async function setExtractionThreshold(key: string, value: number, actor: string): Promise<void> {
  const threshold = extractionThresholds.find((t) => t.key === key);
  if (!threshold) throw new Error(`Unknown threshold: ${key}`);
  if (value < threshold.min || value > threshold.max) {
    throw new Error(`${threshold.label} must be between ${threshold.min} and ${threshold.max}.`);
  }
  extractionThresholds = extractionThresholds.map((t) => (t.key === key ? { ...t, value } : t));
  pushAudit('threshold.updated', `"${threshold.label}" changed: ${threshold.value} → ${value}.`, actor);
}

export async function setValidatorToggle(key: string, enabled: boolean, actor: string): Promise<void> {
  const validator = validatorToggles.find((v) => v.key === key);
  if (!validator) throw new Error(`Unknown validator: ${key}`);
  if (validator.severity === 'blocking' && !enabled) {
    // Allowed, but the UI makes this look dangerous rather than refusing it —
    // there may be a legitimate reason (a validator with a known false-positive
    // bug), and refusing outright would just mean editing this file instead.
  }
  validatorToggles = validatorToggles.map((v) => (v.key === key ? { ...v, enabled } : v));
  pushAudit('validator.toggled', `Validator "${validator.label}" ${enabled ? 'enabled' : 'disabled'}.`, actor);
}

export async function setMaintenanceMode(patch: Partial<MaintenanceMode>, actor: string): Promise<void> {
  const previous = maintenanceMode.enabled;
  maintenanceMode = { ...maintenanceMode, ...patch };
  pushAudit(
    'maintenance.updated',
    maintenanceMode.enabled !== previous
      ? `Maintenance mode ${maintenanceMode.enabled ? 'ENABLED' : 'disabled'} for ${maintenanceMode.clients.join(', ')}.`
      : 'Maintenance mode message/window updated.',
    actor,
  );
}

export async function upsertAnnouncementBanner(banner: AnnouncementBanner, actor: string): Promise<void> {
  const exists = announcementBanners.some((b) => b.id === banner.id);
  announcementBanners = exists
    ? announcementBanners.map((b) => (b.id === banner.id ? banner : b))
    : [...announcementBanners, banner];
  pushAudit(
    exists ? 'banner.updated' : 'banner.created',
    `Banner "${banner.message.slice(0, 60)}${banner.message.length > 60 ? '…' : ''}" ${exists ? 'updated' : 'created'} (${banner.clients.join(', ')}).`,
    actor,
  );
}

export async function removeAnnouncementBanner(id: string, actor: string): Promise<void> {
  const banner = announcementBanners.find((b) => b.id === id);
  announcementBanners = announcementBanners.filter((b) => b.id !== id);
  if (banner) pushAudit('banner.removed', `Banner "${banner.message.slice(0, 60)}" removed.`, actor);
}

export async function updateSupportConfig(patch: Partial<SupportConfig>, actor: string): Promise<void> {
  supportConfig = { ...supportConfig, ...patch };
  pushAudit('support_config.updated', 'Support/contact configuration updated.', actor);
}

export async function updatePlanDefault(planCode: string, patch: Partial<PlanQuotaDefault>, actor: string): Promise<void> {
  const plan = planDefaults.find((p) => p.planCode === planCode);
  if (!plan) throw new Error(`Unknown plan: ${planCode}`);
  planDefaults = planDefaults.map((p) => (p.planCode === planCode ? { ...p, ...patch } : p));
  pushAudit('plan_default.updated', `Plan defaults for ${plan.planName} updated.`, actor);
}

/** Placeholder for the real staff identity (docs/WEB.md §6). Every action attributes to this until then. */
export function currentOperatorLabel(): string {
  return 'you (dev fixture — not yet wired to platform-staff identity)';
}
