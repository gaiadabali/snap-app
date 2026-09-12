import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../types';

/**
 * The platform admin plane (migration 0021).
 *
 * Declared separately from `./tables` and `./enums` rather than appended to
 * them: every table here is reachable ONLY through the SECURITY DEFINER
 * functions owned by `app_platform` (see the migration's header) — `app_rw`
 * has no direct grant on any of them. Keeping them in their own file makes
 * that boundary visible at a glance instead of buried in the middle of the
 * ordinary tenant schema.
 *
 * These declarations exist so `packages/db/test/drift.test.ts` stays
 * meaningful — it fails the build if a migrated table or enum has no
 * Drizzle counterpart. Nothing in `apps/server/src/admin` actually queries
 * through these declarations: every read and write goes through the
 * SECURITY DEFINER functions via raw parameterised SQL, exactly like
 * `identity_sign_in` and friends (0015) already do.
 */

export const platformStaffRole = pgEnum('platform_staff_role', [
  'support',
  'billing',
  'operations',
  'super_admin',
]);

export const platformCapability = pgEnum('platform_capability', [
  'view_analytics',
  'view_tenant_metadata',
  'read_tenant_records',
  'impersonate',
  'manage_billing',
  'manage_platform_settings',
  'manage_ai_config',
  'manage_staff',
  'manage_operations',
  // 0023: reviewing who accessed whose records (the audit-log read) is its
  // own, independently-grantable power — see that migration's header for why
  // it is not folded into `view_tenant_metadata` or `manage_staff` instead.
  // Appended, not inserted, because `ALTER TYPE ... ADD VALUE` always appends
  // and `packages/db/test/drift.test.ts` compares this array to the database
  // in `enumsortorder` — reordering here without a matching `ADD VALUE ...
  // BEFORE` in SQL would fail that test.
  'audit_review',
]);

export const impersonationEndReason = pgEnum('impersonation_end_reason', [
  'expired',
  'stopped',
  'revoked',
]);

export const platformStaff = pgTable('platform_staff', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  role: platformStaffRole('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by'),
});

export const platformStaffCapabilities = pgTable('platform_staff_capabilities', {
  staffId: uuid('staff_id').notNull(),
  capability: platformCapability('capability').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid('granted_by'),
});

export const impersonationSessions = pgTable('impersonation_sessions', {
  id: uuid('id').primaryKey(),
  staffUserId: uuid('staff_user_id').notNull(),
  subjectUserId: uuid('subject_user_id').notNull(),
  subjectTenantId: uuid('subject_tenant_id').notNull(),
  reason: text('reason').notNull(),
  /** SHA-256 of the bearer token. The plaintext token never reaches Postgres. */
  tokenHash: bytea('token_hash').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endedReason: impersonationEndReason('ended_reason'),
});

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: uuid('id').primaryKey(),
  provider: text('provider').notNull(),
  label: text('label').notNull(),
  defaultModel: text('default_model'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

/**
 * The secret itself never lands here as plaintext: `ciphertext` and
 * `wrappedDek` are app-level AEAD output under a KMS-wrapped DEK, not
 * `pgcrypto` — see the migration header and `apps/server/src/admin/crypto/
 * kms.ts`. Only `keyPrefix`/`keyLast4` are ever selected back out.
 */
export const aiProviderKeys = pgTable('ai_provider_keys', {
  id: uuid('id').primaryKey(),
  providerConfigId: uuid('provider_config_id').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyLast4: text('key_last4').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  kmsKeyId: text('kms_key_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by'),
});
