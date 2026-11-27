import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * GOD group consent (migration 0062, god/TASKS.md 9.1.d). Written only through
 * the `god_consent_*` SECURITY DEFINER functions; the API reads under RLS.
 * Declared so `test/drift.test.ts` stays meaningful; the SQL is the source of truth.
 */

/** The record: one row per decision, append-only. */
export const godConsentEvents = pgTable('god_consent_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  /** Always `god-group-notice`. */
  noticeId: text('notice_id').notNull().default('god-group-notice'),
  /** e.g. `1.0`. */
  noticeVersion: text('notice_version').notNull(),
  /** accepted | declined | withdrawn. */
  decision: text('decision').notNull(),
  /** registration | next_sign_in | guardian. */
  method: text('method').notNull(),
  /** The parent who decided for a teen; no foreign key, so erasing the parent leaves the teen's record. */
  guardianUserId: uuid('guardian_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The current answer, one row per person: "who is in" is one indexed read. */
export const godConsentStatus = pgTable('god_consent_status', {
  userId: uuid('user_id').primaryKey(),
  noticeId: text('notice_id').notNull().default('god-group-notice'),
  noticeVersion: text('notice_version').notNull(),
  decision: text('decision').notNull(),
  method: text('method').notNull(),
  guardianUserId: uuid('guardian_user_id'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  eventId: uuid('event_id').notNull(),
});
