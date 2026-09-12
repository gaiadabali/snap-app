import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { asUser, withTenant, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import type {
  AdminAiProviderConfig,
  AdminAiUsageStat,
  AdminAnalyticsOverview,
  AdminImpersonationStartResponse,
  AdminImpersonationStopResponse,
  AdminPlanSummary,
  AdminQueueStat,
  AdminRetentionStatusRow,
  AdminSession,
  AdminStaffSummary,
  AdminTenantDetail,
  AdminTenantDocumentsView,
  AdminTenantSummary,
  AdminUserSummary,
  DocumentSummary,
  PlatformCapability,
  PlatformStaffRole,
} from '@snap/api-contract';

/**
 * Every database access the admin plane makes.
 *
 * One rule, held throughout: nothing here ever sets `app.tenant_id` to
 * "every tenant" or reads a tenant-owned table without one. Every function
 * below either (a) calls a SECURITY DEFINER function from migration 0021,
 * which checks the caller's own capability itself and needs no tenant
 * context, or (b) — for `getTenantDocuments` only — authorises via one of
 * those functions and THEN re-enters through `withTenant` with that one
 * tenant's id, so the actual row read runs under the ordinary,
 * already-reviewed `tenant_isolation` policy. See the migration header for
 * why the cross-tenant decision and the data read are kept as two separate
 * steps.
 *
 * Every exported function takes the STAFF MEMBER'S user id, never a tenant
 * id alone — `asUser` sets `app.user_id`, and every gated Postgres function
 * reads `current_user_id()` itself rather than trusting an argument, exactly
 * like `workspace_create` (0015).
 */

/** Translates a RAISE EXCEPTION from 0021's functions into the right HTTP shape. */
function translate(error: unknown): never {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const message = cause?.message ?? 'That admin action could not be completed.';
  if (cause?.code === '42501') throw new ForbiddenException(message);
  if (cause?.code === 'P0002') throw new NotFoundException(message);
  if (cause?.code === '23514') throw new BadRequestException(message);
  throw error;
}

/**
 * Runs `fn` with `app.user_id` set to the staff member, and turns a RAISE
 * EXCEPTION from any 0021 function into the matching Nest HTTP exception.
 */
async function callAs<T>(staffUserId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await asUser(getDb(), staffUserId, fn);
  } catch (error) {
    translate(error);
  }
}

/* ── Self ────────────────────────────────────────────────────────────────── */

export async function getMyCapabilities(userId: string): Promise<AdminSession | null> {
  const rows = await asUser(getDb(), userId, (tx) =>
    tx.execute<{ staff_id: string; role: PlatformStaffRole; capability: PlatformCapability }>(sql`
      select staff_id, role, capability from admin_my_capabilities()
    `),
  );
  if (rows.rows.length === 0) return null;
  return {
    staffId: rows.rows[0]!.staff_id,
    role: rows.rows[0]!.role,
    capabilities: rows.rows.map((r) => r.capability),
  };
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

export async function getAnalyticsOverview(staffUserId: string): Promise<AdminAnalyticsOverview> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      tenant_count: string;
      active_tenant_count: string;
      user_count: string;
      staff_count: string;
      document_count: string;
      extraction_success_rate: string | null;
      cost_aud_30d: string;
      revenue_aud_30d: string;
    }>(sql`select * from admin_analytics_overview()`);
    const r = rows.rows[0]!;
    return {
      tenantCount: Number(r.tenant_count),
      activeTenantCount: Number(r.active_tenant_count),
      userCount: Number(r.user_count),
      staffCount: Number(r.staff_count),
      documentCount: Number(r.document_count),
      extractionSuccessRate: r.extraction_success_rate == null ? null : Number(r.extraction_success_rate),
      costAud30d: r.cost_aud_30d,
      revenueAud30d: r.revenue_aud_30d,
    };
  });
}

export async function getQueueStats(staffUserId: string): Promise<AdminQueueStat[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      kind: string;
      pending: string;
      locked: string;
      stalled_at_max: string;
      oldest_pending_age: string | null;
    }>(sql`select kind, pending, locked, stalled_at_max, oldest_pending_age::text as oldest_pending_age
             from admin_queue_stats()`);
    return rows.rows.map((r) => ({
      kind: r.kind,
      pending: Number(r.pending),
      locked: Number(r.locked),
      stalledAtMax: Number(r.stalled_at_max),
      oldestPendingAge: r.oldest_pending_age,
    }));
  });
}

export async function getRetentionStatus(staffUserId: string): Promise<AdminRetentionStatusRow[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      tenant_id: string;
      name: string;
      oldest_document_issue_date: string | null;
      retention_months: number | null;
    }>(sql`select tenant_id, name, oldest_document_issue_date::text as oldest_document_issue_date,
                  retention_months from admin_retention_status()`);
    return rows.rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      oldestDocumentIssueDate: r.oldest_document_issue_date,
      retentionMonths: r.retention_months,
    }));
  });
}

/* ── Tenants and users ───────────────────────────────────────────────────── */

export async function searchTenants(
  staffUserId: string,
  query: string | null,
  limit: number,
  offset: number,
): Promise<AdminTenantSummary[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      tenant_id: string;
      name: string;
      kind: 'business' | 'personal';
      plan_code: string | null;
      member_count: string;
      created_at: string;
      deleted_at: string | null;
    }>(sql`select * from admin_tenant_search(${query}, ${limit}, ${offset})`);
    return rows.rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      kind: r.kind,
      planCode: r.plan_code,
      memberCount: Number(r.member_count),
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    }));
  });
}

export async function getTenantDetail(staffUserId: string, tenantId: string): Promise<AdminTenantDetail> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      tenant_id: string;
      name: string;
      kind: 'business' | 'personal';
      abn: string | null;
      country: string;
      plan_code: string | null;
      member_count: string;
      created_at: string;
      deleted_at: string | null;
    }>(sql`select * from admin_tenant_detail(${tenantId})`);
    const r = rows.rows[0]!;
    return {
      tenantId: r.tenant_id,
      name: r.name,
      kind: r.kind,
      abn: r.abn,
      country: r.country,
      planCode: r.plan_code,
      memberCount: Number(r.member_count),
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    };
  });
}

export async function searchUsers(
  staffUserId: string,
  query: string | null,
  limit: number,
  offset: number,
): Promise<AdminUserSummary[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      user_id: string;
      email: string | null;
      display_name: string | null;
      created_at: string;
      tenant_count: string;
    }>(sql`select * from admin_user_search(${query}, ${limit}, ${offset})`);
    return rows.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      createdAt: r.created_at,
      tenantCount: Number(r.tenant_count),
    }));
  });
}

/**
 * Authorises AND audits a staff read of one tenant's records — see the
 * migration header, rule 5. Deliberately returns nothing about the tenant:
 * the caller re-enters through `withTenant` afterward for the actual data.
 */
async function authorizeTenantRecords(staffUserId: string, tenantId: string, reason: string): Promise<void> {
  await callAs(staffUserId, (tx) =>
    tx.execute(sql`select admin_authorize_tenant_records(${tenantId}, ${reason})`),
  );
}

export async function getTenantDocuments(
  staffUserId: string,
  tenantId: string,
  reason: string,
): Promise<AdminTenantDocumentsView> {
  await authorizeTenantRecords(staffUserId, tenantId, reason);
  return readTenantDocuments(tenantId);
}

/**
 * The same read, for a caller already authorised and audited by
 * `admin_impersonation_verify` (`TenantRecordsAccessGuard`) — there is no
 * separate reason to collect, because the impersonation session already
 * carries one from `admin_impersonation_start`.
 */
export async function getImpersonatedTenantDocuments(tenantId: string): Promise<AdminTenantDocumentsView> {
  return readTenantDocuments(tenantId);
}

async function readTenantDocuments(tenantId: string): Promise<AdminTenantDocumentsView> {
  // The scoped read itself. `withTenant`, not `withTenantAs`: a staff member
  // is not a member of the tenant, and must not be made to look like one —
  // authorisation for this read already happened, either via
  // `authorizeTenantRecords` above or via `admin_impersonation_verify`.
  const rows = await withTenant(getDb(), tenantId, (tx) =>
    tx.execute<{
      id: string;
      capture_id: string;
      doc_type: string;
      is_tax_invoice: boolean;
      supplier_name: string | null;
      supplier_abn: string | null;
      issue_date: string | null;
      currency: string;
      tax_amount: string | null;
      payable_amount: string | null;
      review_status: string;
      confidence_overall: string | null;
    }>(sql`
      select d.id, d.capture_id, d.doc_type::text as doc_type, d.is_tax_invoice,
             p.legal_name as supplier_name, p.abn as supplier_abn,
             d.issue_date::text as issue_date, d.currency::text as currency,
             d.tax_amount::text as tax_amount, d.payable_amount::text as payable_amount,
             d.review_status::text as review_status, d.confidence_overall::text as confidence_overall
        from documents d
        left join parties p on p.id = d.supplier_id
       where d.deleted_at is null
       order by d.issue_date desc nulls last, d.created_at desc
       limit 200
    `),
  );

  const documents: DocumentSummary[] = rows.rows.map((r) => ({
    id: r.id,
    captureId: r.capture_id,
    docType: r.doc_type as DocumentSummary['docType'],
    isTaxInvoice: r.is_tax_invoice,
    supplierName: r.supplier_name,
    supplierAbn: r.supplier_abn,
    issueDate: r.issue_date,
    currency: r.currency,
    taxAmount: r.tax_amount,
    payableAmount: r.payable_amount,
    reviewStatus: r.review_status as DocumentSummary['reviewStatus'],
    confidenceOverall: r.confidence_overall == null ? null : Number(r.confidence_overall),
    // Field-level locks and thumbnails are the ordinary product view's job
    // (`apps/server/src/documents`); the admin read is a read-only summary
    // for support/compliance purposes, not a substitute for it.
    lockedFields: [],
    thumbnailUrl: null,
  }));

  return { tenantId, documents };
}

/* ── Staff ───────────────────────────────────────────────────────────────── */

export async function addStaff(
  staffUserId: string,
  targetUserId: string,
  role: PlatformStaffRole,
  capabilities: PlatformCapability[],
): Promise<AdminStaffSummary> {
  const staffId = await callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ admin_staff_add: string }>(sql`
      select admin_staff_add(${targetUserId}, ${role}::platform_staff_role, ${capabilities}::platform_capability[])
    `);
    return rows.rows[0]!.admin_staff_add;
  });
  const list = await listStaff(staffUserId);
  return list.find((s) => s.staffId === staffId)!;
}

export async function setStaffCapability(
  staffUserId: string,
  targetStaffId: string,
  capability: PlatformCapability,
  grant: boolean,
): Promise<void> {
  await callAs(staffUserId, (tx) =>
    tx.execute(sql`select admin_staff_set_capability(${targetStaffId}, ${capability}::platform_capability, ${grant})`),
  );
}

export async function revokeStaff(staffUserId: string, targetStaffId: string): Promise<void> {
  await callAs(staffUserId, (tx) => tx.execute(sql`select admin_staff_revoke(${targetStaffId})`));
}

export async function listStaff(staffUserId: string): Promise<AdminStaffSummary[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      staff_id: string;
      user_id: string;
      email: string | null;
      display_name: string | null;
      role: PlatformStaffRole;
      capabilities: PlatformCapability[];
      created_at: string;
      revoked_at: string | null;
    }>(sql`select * from admin_staff_list()`);
    return rows.rows.map((r) => ({
      staffId: r.staff_id,
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      capabilities: r.capabilities,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    }));
  });
}

/* ── Plans and usage ─────────────────────────────────────────────────────── */

export async function listPlans(staffUserId: string): Promise<AdminPlanSummary[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      plan_id: string;
      code: string;
      name: string;
      price_cents: number;
      scan_quota: number | null;
      seat_limit: number;
      is_active: boolean;
    }>(sql`select * from admin_plan_list()`);
    return rows.rows.map((r) => ({
      planId: r.plan_id,
      code: r.code,
      name: r.name,
      priceCents: r.price_cents,
      scanQuota: r.scan_quota,
      seatLimit: r.seat_limit,
      isActive: r.is_active,
    }));
  });
}

export async function setTenantPlan(
  staffUserId: string,
  tenantId: string,
  planId: string,
  reason: string,
): Promise<string> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ admin_tenant_set_plan: string }>(
      sql`select admin_tenant_set_plan(${tenantId}, ${planId}, ${reason})`,
    );
    return rows.rows[0]!.admin_tenant_set_plan;
  });
}

export async function grantUsage(
  staffUserId: string,
  tenantId: string,
  metric: string,
  amount: number,
  reason: string,
): Promise<string> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ admin_usage_grant: string }>(
      sql`select admin_usage_grant(${tenantId}, ${metric}, ${amount}, ${reason})`,
    );
    return rows.rows[0]!.admin_usage_grant;
  });
}

/* ── Platform settings ───────────────────────────────────────────────────── */

export async function listSettings(
  staffUserId: string,
): Promise<Array<{ key: string; value: unknown; updatedAt: string }>> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ key: string; value: unknown; updated_at: string }>(
      sql`select * from admin_setting_list()`,
    );
    return rows.rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }));
  });
}

export async function setSetting(
  staffUserId: string,
  key: string,
  value: unknown,
  reason: string,
): Promise<void> {
  await callAs(staffUserId, (tx) =>
    tx.execute(sql`select admin_setting_set(${key}, ${JSON.stringify(value)}::jsonb, ${reason})`),
  );
}

/* ── AI provider / model / key configuration ────────────────────────────── */

export async function upsertAiProvider(
  staffUserId: string,
  provider: string,
  label: string,
  defaultModel: string | null,
  isActive: boolean,
): Promise<string> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ admin_ai_provider_upsert: string }>(
      sql`select admin_ai_provider_upsert(${provider}, ${label}, ${defaultModel}, ${isActive})`,
    );
    return rows.rows[0]!.admin_ai_provider_upsert;
  });
}

export async function listAiProviders(staffUserId: string): Promise<AdminAiProviderConfig[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      provider: string;
      label: string;
      default_model: string | null;
      is_active: boolean;
      has_live_key: boolean;
      key_prefix: string | null;
      key_last4: string | null;
    }>(sql`select * from admin_ai_provider_list()`);
    return rows.rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      defaultModel: r.default_model,
      isActive: r.is_active,
      hasLiveKey: r.has_live_key,
      keyPrefix: r.key_prefix,
      keyLast4: r.key_last4,
    }));
  });
}

export async function storeAiKey(
  staffUserId: string,
  providerConfigId: string,
  keyPrefix: string,
  keyLast4: string,
  ciphertext: Buffer,
  wrappedDek: Buffer,
  kmsKeyId: string,
): Promise<string> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ admin_ai_key_store: string }>(sql`
      select admin_ai_key_store(${providerConfigId}, ${keyPrefix}, ${keyLast4}, ${ciphertext}, ${wrappedDek}, ${kmsKeyId})
    `);
    return rows.rows[0]!.admin_ai_key_store;
  });
}

export async function revokeAiKey(staffUserId: string, keyId: string, reason: string): Promise<void> {
  await callAs(staffUserId, (tx) => tx.execute(sql`select admin_ai_key_revoke(${keyId}, ${reason})`));
}

export async function getAiUsageSummary(staffUserId: string): Promise<AdminAiUsageStat[]> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{
      engine: string;
      model_id: string | null;
      runs: string;
      succeeded: string;
      failed: string;
      cost_aud: string;
      avg_latency_ms: string | null;
    }>(sql`select * from admin_ai_usage_summary()`);
    return rows.rows.map((r) => ({
      engine: r.engine,
      modelId: r.model_id,
      runs: Number(r.runs),
      succeeded: Number(r.succeeded),
      failed: Number(r.failed),
      costAud: r.cost_aud,
      avgLatencyMs: r.avg_latency_ms == null ? null : Number(r.avg_latency_ms),
    }));
  });
}

/* ── Operations ──────────────────────────────────────────────────────────── */

export async function triggerReextraction(
  staffUserId: string,
  tenantId: string,
  captureId: string,
  reason: string,
): Promise<string> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ admin_trigger_reextraction: string }>(
      sql`select admin_trigger_reextraction(${tenantId}, ${captureId}, ${reason})`,
    );
    return rows.rows[0]!.admin_trigger_reextraction;
  });
}

/* ── Impersonation ───────────────────────────────────────────────────────── */

export async function startImpersonation(
  staffUserId: string,
  subjectUserId: string,
  subjectTenantId: string,
  reason: string,
  tokenHash: Buffer,
  ttlSeconds: number | undefined,
): Promise<Pick<AdminImpersonationStartResponse, 'sessionId' | 'expiresAt'>> {
  return callAs(staffUserId, async (tx) => {
    const rows = await tx.execute<{ session_id: string; expires_at: string }>(sql`
      select * from admin_impersonation_start(${subjectUserId}, ${subjectTenantId}, ${reason}, ${tokenHash}, ${ttlSeconds ?? null})
    `);
    const r = rows.rows[0]!;
    return { sessionId: r.session_id, expiresAt: r.expires_at };
  });
}

export async function stopImpersonation(
  staffUserId: string,
  sessionId: string,
): Promise<AdminImpersonationStopResponse> {
  return callAs(staffUserId, async (tx) => {
    // `admin_impersonation_stop` returns its own `ended_reason` rather than
    // void, precisely so this never needs a follow-up SELECT against
    // `impersonation_sessions` — `app_rw` has no grant on that table at all
    // (0021's explicit REVOKE ALL), so such a query would fail outright.
    const rows = await tx.execute<{ admin_impersonation_stop: AdminImpersonationStopResponse['endedReason'] }>(
      sql`select admin_impersonation_stop(${sessionId})`,
    );
    return { sessionId, endedReason: rows.rows[0]!.admin_impersonation_stop };
  });
}

/**
 * Verifies (and, on success, AUDITS) one request made under an impersonation
 * token. This is the only admin.repo function called with NO staff user id —
 * the token itself is the credential, exactly like an upload/download/image
 * token (`apps/server/src/tokens.ts`).
 */
export async function verifyImpersonation(
  tokenHash: Buffer,
  method: string,
  path: string,
): Promise<{ sessionId: string; staffUserId: string; subjectUserId: string; subjectTenantId: string } | null> {
  const rows = await getDb().execute<{
    session_id: string;
    staff_user_id: string;
    subject_user_id: string;
    subject_tenant_id: string;
  }>(sql`select * from admin_impersonation_verify(${tokenHash}, ${method}, ${path})`);
  const r = rows.rows[0];
  if (!r) return null;
  return {
    sessionId: r.session_id,
    staffUserId: r.staff_user_id,
    subjectUserId: r.subject_user_id,
    subjectTenantId: r.subject_tenant_id,
  };
}
