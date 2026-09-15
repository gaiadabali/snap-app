import { boolean, integer, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { billingProvider } from './enums';

/**
 * Credits and points (migration 0024).
 *
 * Declared in their own file for the same reason `./admin-plane` is: the two
 * halves obey different isolation rules and putting them beside the ordinary
 * tenant tables would hide that. Credits are TENANT-scoped and behave like
 * every other tenant row; `point_ledger` is USER-scoped, because a point is
 * earned by a person and redeemed in a different app in the ecosystem where a
 * workspace means nothing. See `docs/ECOSYSTEM.md` D27.
 *
 * Present primarily so `packages/db/test/drift.test.ts` stays meaningful — it
 * fails the build if a migrated table or enum has no Drizzle counterpart.
 *
 * NOTE ON MONEY. `price_aud` is `numeric(12,4)` and Drizzle hands it back as a
 * STRING. Do not "fix" that by adding a numeric mode: a JSON float cannot hold
 * 110.10 exactly, and the same rule that governs the ledger governs the price
 * list. It crosses the wire as `MoneyString`.
 */

export const creditPurchaseStatus = pgEnum('credit_purchase_status', [
  'pending',
  'paid',
  'failed',
  'refunded',
]);

/** The catalogue. Readable by all, written only by migrations — like `plans`. */
export const creditPacks = pgTable('credit_packs', {
  code: text('code').primaryKey(),
  credits: integer('credits').notNull(),
  priceAud: numeric('price_aud', { precision: 12, scale: 4 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The money record, separate from the balance.
 *
 * `usage_grants` answers "how many scans are left". This answers "what was
 * paid, by whom, through which processor, and can it be refunded" — and it has
 * to outlive the grant being fully consumed.
 */
export const creditPurchases = pgTable('credit_purchases', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  purchasedBy: uuid('purchased_by'),
  packCode: text('pack_code').notNull(),
  credits: integer('credits').notNull(),
  /** Captured at purchase time — an old receipt must still say what was paid. */
  priceAud: numeric('price_aud', { precision: 12, scale: 4 }).notNull(),
  status: creditPurchaseStatus('status').notNull().default('pending'),
  /* The EXISTING `billing_provider` enum (0008), not a new text column — the
     processor list is shared with `subscriptions` and must not fork. */
  provider: billingProvider('provider').notNull().default('manual'),
  providerRef: text('provider_ref'),
  /** NULL until paid: credits must never exist before the money does. */
  grantId: uuid('grant_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
});

/**
 * Append-only. `app_rw` has no UPDATE or DELETE, by grant rather than by
 * convention — outstanding points are a liability, and a balance that can be
 * quietly rewritten is not auditable. A correction is a compensating entry.
 */
export const pointLedger = pgTable('point_ledger', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  /** Positive earns, negative redeems. Never zero. */
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  ref: text('ref'),
  /** Which ecosystem app moved it — earned here, spent elsewhere. */
  app: text('app').notNull().default('snap-apps'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
