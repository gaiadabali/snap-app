import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../types';

/**
 * Teen spaces (migration 0045, group 3.10). Written only through the
 * `teen_*` SECURITY DEFINER functions; declared so `test/drift.test.ts`
 * stays meaningful.
 */
export const teenInvites = pgTable('teen_invites', {
  /** YourTal's inviteId. */
  id: uuid('id').primaryKey(),
  parentUserId: uuid('parent_user_id').notNull(),
  fundingTenantId: uuid('funding_tenant_id').notNull(),
  codeSha256: bytea('code_sha256').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teenSpaces = pgTable('teen_spaces', {
  tenantId: uuid('tenant_id').primaryKey(),
  teenUserId: uuid('teen_user_id').notNull(),
  parentUserId: uuid('parent_user_id'),
  fundingTenantId: uuid('funding_tenant_id'),
  inviteId: uuid('invite_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  accessEndedAt: timestamp('access_ended_at', { withTimezone: true }),
  /** YourTal confirmed the invite ended. */
  yourtalEndedAt: timestamp('yourtal_ended_at', { withTimezone: true }),
  /** 3.10.f erases the space from here. */
  eraseAfter: timestamp('erase_after', { withTimezone: true }),
});

/** No tenant_id on purpose: see 0045's header. */
export const teenSpaceSpends = pgTable('teen_space_spends', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** NULL once the teen's capture is gone; the record stays with the parent's workspace. */
  captureId: uuid('capture_id'),
  fundingTenantId: uuid('funding_tenant_id').notNull(),
  grantId: uuid('grant_id'),
  spentAt: timestamp('spent_at', { withTimezone: true }).notNull().defaultNow(),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
});
