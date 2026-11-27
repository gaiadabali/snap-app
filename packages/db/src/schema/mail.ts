import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Spambank mail on SnapApp (migration 0060; spambank/BUILD.md §4.9, §6).
 *
 * Both tables are USER-scoped, like `yourtal_links`: the API reaches them only
 * under `asUser`, and a write to `push_tokens` goes through the SECURITY DEFINER
 * function `mail_push_token_register` (a token moves between accounts, which
 * RLS would hide from a plain upsert). Declared mainly so `test/drift.test.ts`
 * stays meaningful; the SQL is the source of truth.
 */

/** One Firebase Cloud Messaging registration token per phone that wants new-mail alerts. */
export const pushTokens = pgTable('push_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  /** 'android'. */
  platform: text('platform').notNull(),
  /** Unique across all users. Never logged. */
  token: text('token').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What SnapApp keeps about a person's Spambank mailbox: where mailed statements go, and whether alerts are on. */
export const mailSettings = pgTable('mail_settings', {
  userId: uuid('user_id').primaryKey(),
  /** The workspace mailed statements are imported into; cleared if that workspace is erased. */
  importTenantId: uuid('import_tenant_id'),
  alerts: boolean('alerts').notNull().default(true),
});

/**
 * Statements that arrived in the person's Spambank mailbox (migration 0062,
 * BUILD.md §4.8): one row per offered attachment, the import's idempotency key
 * and the "Imported from Spambank" list. The API only reads its own rows; the
 * worker writes them after `asUser(person)`.
 */
export const mailStatementImports = pgTable('mail_statement_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  emailId: text('email_id').notNull(),
  blobId: text('blob_id').notNull(),
  fileName: text('file_name'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  /** The workspace the file went into; cleared if that workspace is erased. */
  tenantId: uuid('tenant_id'),
  /** The capture it became; cleared if that capture is erased. */
  captureId: uuid('capture_id'),
  /** pending | imported | duplicate | skipped | failed */
  status: text('status').notNull().default('pending'),
  detail: text('detail'),
  ackedAt: timestamp('acked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
