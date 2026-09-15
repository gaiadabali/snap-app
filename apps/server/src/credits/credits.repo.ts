import { randomUUID } from 'node:crypto';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * Credits — bought with money, or granted free at signup. Tenant-scoped,
 * because a credit buys a scan and a scan happens inside a workspace.
 * `docs/ECOSYSTEM.md` D27; migration 0024.
 *
 * Deliberately separate from the topup arithmetic `repo.ts#readPlan` already
 * does (`topup_remaining`, folded into `PlanUsage.scansRemaining` for the
 * "can I scan right now" question). This file answers a different
 * question — "what did I buy or get for free, and what is left of just
 * that" — and the two must never be silently added together a second time:
 * see D27's table of three balances that look alike and are not.
 */

export type CreditPackRow = {
  code: string;
  credits: number;
  price_aud: string;
  sort_order: number;
};

/**
 * The catalogue, active packs only, in display order.
 *
 * `credit_packs` is readable by anyone (`credit_packs_read ... USING (true)`
 * — it is a price list, not tenant data), but this still runs through
 * `withTenantAs` rather than a bare `getDb().execute`, so a signed-in,
 * non-member caller gets the same "not a member of this workspace" refusal
 * every other endpoint gives, instead of a second, looser security story for
 * "public" reads.
 */
export async function listCreditPacks(userId: string, tenantId: string): Promise<CreditPackRow[]> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<CreditPackRow>(sql`
      select code, credits, price_aud::text as price_aud, sort_order
        from credit_packs
       where active = true
       order by sort_order
    `);
    return rows.rows;
  });
}

/**
 * The credits balance ALONE — sum of live `usage_grants.remaining` where
 * `metric = 'scans'`. NOT the plan quota, and NOT points. See the header on
 * `CreditBalance` in `@snap/api-contract` for why these stay apart.
 */
export async function getCreditBalance(userId: string, tenantId: string): Promise<number> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<{ remaining: number }>(sql`
      select coalesce(sum(remaining), 0)::int as remaining
        from usage_grants
       where tenant_id = current_tenant_id()
         and metric = 'scans'
         and remaining > 0
         and (expires_at is null or expires_at > now())
    `);
    return rows.rows[0]?.remaining ?? 0;
  });
}

export type CreditPurchaseRow = {
  id: string;
  pack_code: string;
  credits: number;
  price_aud: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  provider: string;
  created_at: string;
  paid_at: string | null;
};

/** Purchase history for this workspace, most recent first. */
/*
 * Timestamps are rendered with `to_json(col)#>>'{}'`, never `::text`.
 *
 * `::text` gives Postgres' own rendering — "2026-09-15 16:12:40.13896+00", a
 * space instead of a `T` — while the contract declares `IsoDateTime`. V8 parses
 * that leniently so it appears to work, which is exactly why it keeps coming
 * back: the same drift was fixed across the admin endpoints and reintroduced
 * here the moment a new repo was written. `to_json` yields real ISO 8601 via
 * jsonb encoding, matching `apps/server/src/repo.ts`.
 *
 * It matters beyond tidiness: `Date.parse` returns NaN on anything stricter,
 * and every comparison against NaN is false — so an expiry or ordering check
 * written the obvious way treats an unreadable timestamp as fine.
 */
export async function listCreditPurchases(userId: string, tenantId: string): Promise<CreditPurchaseRow[]> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<CreditPurchaseRow>(sql`
      select id, pack_code, credits, price_aud::text as price_aud, status::text as status,
             provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at
        from credit_purchases
       where tenant_id = current_tenant_id()
       order by created_at desc
    `);
    return rows.rows;
  });
}

/**
 * Starts a purchase: `pending`, no grant, no credits yet.
 *
 * There is no payment processor — Stripe is phase 6.5 and unwired — so this
 * is deliberately NOT a checkout. It is the record a processor's webhook
 * would eventually flip to `paid` via `fulfilCreditPurchase`. The CHECK
 * constraints in migration 0024 (`purchase_paid_has_grant`,
 * `purchase_paid_has_time`) make `paid` without a grant unrepresentable, so
 * this function structurally cannot hand out credits before the money does.
 *
 * Returns `null` for an unknown or retired pack code, which the controller
 * turns into a 404 rather than trusting a client-supplied price.
 */
export async function startCreditPurchase(
  userId: string,
  tenantId: string,
  packCode: string,
): Promise<CreditPurchaseRow | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const pack = await tx.execute<{ code: string; credits: number; price_aud: string }>(sql`
      select code, credits, price_aud::text as price_aud
        from credit_packs
       where code = ${packCode} and active = true
       limit 1
    `);
    const row = pack.rows[0];
    if (!row) return null;

    const id = randomUUID();
    const inserted = await tx.execute<CreditPurchaseRow>(sql`
      insert into credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider)
      values (${id}, current_tenant_id(), ${userId}, ${row.code}, ${row.credits}, ${row.price_aud}, 'pending', 'manual')
      returning id, pack_code, credits, price_aud::text as price_aud, status::text as status,
                provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at
    `);
    return inserted.rows[0]!;
  });
}

/** Thrown by `fulfilCreditPurchase` when the purchase is not `pending` —
 *  already fulfilled is handled separately (see below); this is for
 *  `failed`/`refunded`, which nothing should silently resurrect into `paid`. */
export class CreditPurchaseNotPendingError extends Error {
  constructor(readonly status: string) {
    super(`credit purchase is ${status}, not pending`);
    this.name = 'CreditPurchaseNotPendingError';
  }
}

/**
 * The manual/admin fulfilment step a real payment processor's webhook will
 * eventually replace. Marks the purchase `paid`, inserts the `usage_grants`
 * row, and links `grant_id` — atomically, in one transaction, so a purchase
 * can never be observed sitting between "paid" and "has credits".
 *
 * WHAT A REAL PROCESSOR MUST CALL INSTEAD OF THIS: its webhook handler,
 * verified against the provider's own signature, should run this exact
 * sequence — update status, insert the grant, link grant_id, one
 * transaction — but keyed by `provider` + `provider_ref` rather than a
 * client-supplied purchase id, so a duplicate webhook delivery is caught by
 * `credit_purchases_provider_ref_idx` (migration 0024) instead of granting
 * twice. `provider` would also stop defaulting to `'manual'`.
 *
 * Idempotent on an already-`paid` purchase — returns it unchanged rather
 * than granting a second time, so a retried admin click (or, once one
 * exists, a retried webhook) cannot double the credits. `FOR UPDATE` locks
 * the row for the length of this check-then-write, which is what makes that
 * safe against a second, concurrent fulfilment call rather than merely
 * likely to work.
 */
export async function fulfilCreditPurchase(
  userId: string,
  tenantId: string,
  purchaseId: string,
): Promise<CreditPurchaseRow | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const found = await tx.execute<CreditPurchaseRow>(sql`
      select id, pack_code, credits, price_aud::text as price_aud, status::text as status,
             provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at
        from credit_purchases
       where id = ${purchaseId} and tenant_id = current_tenant_id()
       for update
    `);
    const purchase = found.rows[0];
    if (!purchase) return null;
    if (purchase.status === 'paid') return purchase;
    if (purchase.status !== 'pending') throw new CreditPurchaseNotPendingError(purchase.status);

    const grantId = randomUUID();
    await tx.execute(sql`
      insert into usage_grants (id, tenant_id, metric, amount, remaining, source)
      values (${grantId}, current_tenant_id(), 'scans', ${purchase.credits}, ${purchase.credits}, 'topup_pack')
    `);
    const updated = await tx.execute<CreditPurchaseRow>(sql`
      update credit_purchases
         set status = 'paid', paid_at = now(), grant_id = ${grantId}
       where id = ${purchaseId} and tenant_id = current_tenant_id()
      returning id, pack_code, credits, price_aud::text as price_aud, status::text as status,
                provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at
    `);
    return updated.rows[0]!;
  });
}

/**
 * The ten free scans a brand-new account gets (`docs/ECOSYSTEM.md` D27;
 * migration 0024, `source = 'signup_bonus'`). Attached to the FIRST tenant
 * this user ever creates, and never a second time.
 *
 * `usage_grants` has no user column — it is tenant-scoped, like every row it
 * sits beside — so "has this account already had its ten" can only be
 * answered by walking every tenant this user belongs to and asking each one
 * in ITS OWN RLS context: the table fails closed with no tenant context set,
 * so there is no cross-tenant shortcut, by design.
 *
 * Manages its own transaction rather than calling `withTenantAs` once per
 * tenant (which would spread the check and the write across several
 * connections) because the whole sequence — check every tenant, then
 * conditionally write to the new one — has to be atomic against a second,
 * concurrent call for the SAME user: two browser tabs finishing onboarding
 * at once, or a response lost in transit and retried (onboarding carries no
 * `Idempotency-Key` coverage — see `IdempotencyInterceptor`'s own comment on
 * why). `pg_advisory_xact_lock`, keyed on the user, serialises exactly that
 * pair of calls; it releases automatically at COMMIT or ROLLBACK, so a crash
 * never strands it held.
 */
export async function grantSignupBonusIfFirst(
  userId: string,
  newTenantId: string,
): Promise<{ granted: boolean }> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const memberships = await tx.execute<{ tenant_id: string }>(sql`
      select tenant_id from memberships where user_id = current_user_id()
    `);

    for (const { tenant_id } of memberships.rows) {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant_id}, true)`);
      const already = await tx.execute<{ found: boolean }>(sql`
        select exists(
          select 1 from usage_grants
           where tenant_id = current_tenant_id() and source = 'signup_bonus'
        ) as found
      `);
      if (already.rows[0]?.found) return { granted: false };
    }

    if (!memberships.rows.some((m) => m.tenant_id === newTenantId)) {
      // Not actually a member of the tenant being credited — refuse rather
      // than write somewhere RLS would reject anyway, so the failure mode is
      // a clear no-op instead of a thrown RLS error surfacing as a 500.
      return { granted: false };
    }

    await tx.execute(sql`select set_config('app.tenant_id', ${newTenantId}, true)`);
    await tx.execute(sql`
      insert into usage_grants (id, tenant_id, metric, amount, remaining, source)
      values (${randomUUID()}, current_tenant_id(), 'scans', 10, 10, 'signup_bonus')
    `);
    return { granted: true };
  });
}
