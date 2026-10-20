import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { citext } from '../types';

/**
 * The YourTal points link (migration 0037).
 *
 * USER-scoped, like `point_ledger`: a YourTal account belongs to a person,
 * not a workspace. The API reaches these only under `asUser`; the worker reads
 * the outbox across users (a queue) and re-enters as the event's user to
 * touch a link. Declared mainly so `test/drift.test.ts` stays meaningful.
 *
 * `region`, `broken_reason`, `action` and `status` are text with CHECK
 * constraints in the SQL rather than enums — the SQL is the source of truth.
 */
export const yourtalLinks = pgTable('yourtal_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  /** YourTal's `linkId`. */
  linkId: uuid('link_id').notNull(),
  /** 'AU' | 'ID'. */
  region: text('region').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  brokenAt: timestamp('broken_at', { withTimezone: true }),
  /** 'link_revoked' | 'unknown_link'. */
  brokenReason: text('broken_reason'),
});

/**
 * A transactional outbox of reports owed to YourTal, drained by the worker.
 *
 * Unique in the SQL, not declared here: `(user_id, action, external_ref)`
 * (0037) and `(user_id, action, capture_id)` where `capture_id` is not null
 * (0038, one report per capture).
 */
export const yourtalOutbox = pgTable('yourtal_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  linkRowId: uuid('link_row_id').notNull(),
  captureId: uuid('capture_id'),
  action: text('action').notNull().default('receipt_scanned'),
  /** `rcpt:v1:<hex>` (a keyed content ref) or `sha256:<hex>` (the image); a skipped row always holds the image ref. */
  externalRef: text('external_ref').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  /** The exact JSON text signed and sent on every attempt. */
  body: text('body').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lastHttpStatus: integer('last_http_status'),
  lastCode: text('last_code'),
  lastError: text('last_error'),
  duplicateOfCaptureId: uuid('duplicate_of_capture_id'),
  granted: boolean('granted'),
  points: integer('points'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/**
 * A started "Sign in with YourTal" (migration 0039): the `state`, `nonce` and
 * PKCE verifier the finish must match, for ten minutes, once. Reached only
 * through `identity_yourtal_flow_*` (SECURITY DEFINER, owned by app_identity);
 * the application role has no grant and no policy here.
 */
export const yourtalSignInFlows = pgTable('yourtal_sign_in_flows', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'web' | 'mobile'. */
  client: text('client').notNull(),
  state: text('state').notNull(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  returnTo: text('return_to'),
  signUp: boolean('sign_up').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

/**
 * The manual review list for Sign in with YourTal (0039, group task 3.6.c):
 * a second YourTal `sub` for a linked email, an email copy that would collide,
 * or an account whose subject is not a format this code links. Written only by
 * `identity_yourtal_sign_in`; one open row per (kind, sub).
 */
export const yourtalSignInReviews = pgTable('yourtal_sign_in_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 'second_sub' | 'email_collision' | 'unlinkable_account'. */
  kind: text('kind').notNull(),
  yourtalSub: text('yourtal_sub').notNull(),
  email: citext('email'),
  userId: uuid('user_id'),
  otherUserId: uuid('other_user_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(1),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  resolution: text('resolution'),
});
