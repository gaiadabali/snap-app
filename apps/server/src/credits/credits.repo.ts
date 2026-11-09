import { randomUUID } from 'node:crypto';

import { withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { creditsLeft } from './spend.js';

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
  // A teen's space has none of its own: its scans spend the parent's (0045).
  return withTenantAs(getDb(), userId, tenantId, async (tx) => (await creditsLeft(tx)).left);
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
         -- A Play void recorded for a purchase never granted (recordGooglePlayVoid):
         -- not an order the buyer made here (8.3.b follow-up review L4, L5).
         and not (provider = 'google' and status = 'refunded' and grant_id is null)
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

/** A processor payment through a checkout session other than the purchase's own. */
export class DuplicateCreditPaymentError extends Error {
  constructor(
    readonly status: string,
    readonly ownSession: string,
  ) {
    super(`credit purchase (${status}) was opened with session ${ownSession}, not this one`);
    this.name = 'DuplicateCreditPaymentError';
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

/**
 * Fulfilment from a payment processor's webhook.
 *
 * This is the function `fulfilCreditPurchase`'s header describes under
 * "WHAT A REAL PROCESSOR MUST CALL INSTEAD OF THIS", built to that
 * specification: the same sequence — update status, insert the grant, link
 * `grant_id`, one transaction — but recording `provider` and `provider_ref`
 * so a duplicate delivery is caught rather than granting twice.
 *
 * ── Three things make a repeat delivery safe, not one ─────────────────────
 *
 * Stripe retries a webhook until it gets a 2xx, and will happily deliver the
 * same event twice on a network hiccup. So:
 *
 *  1. `FOR UPDATE` locks the purchase row for the length of the
 *     check-then-write, which is what makes two SIMULTANEOUS deliveries safe
 *     rather than merely usually fine.
 *  2. An already-`paid` purchase returns unchanged. This is the common case
 *     for a retry and it must not be an error — answering non-2xx would make
 *     Stripe retry forever.
 *  3. `credit_purchases_provider_ref_idx` (migration 0024) is unique over
 *     `(provider, provider_ref)`, so even if 1 and 2 were both wrong the
 *     database refuses the second grant. That index has been waiting for
 *     this caller since it was written.
 *
 * ── Why it takes a userId and tenantId it did not authenticate ───────────
 *
 * A webhook has no session. These come from the processor's metadata, which
 * WE set when creating the checkout and which arrives inside a payload whose
 * HMAC signature has already been verified — so they are our own values
 * handed back, not caller-supplied input. Everything then runs inside
 * `withTenantAs`, under ordinary RLS, exactly as a signed-in request would.
 * The alternative — searching for the purchase across tenants — is the
 * cross-tenant read this schema exists to make impossible.
 */
export async function fulfilCreditPurchaseFromProvider(
  userId: string,
  tenantId: string,
  purchaseId: string,
  provider: 'stripe' | 'apple' | 'google',
  providerRef: string,
  paymentRef: string | null = null,
): Promise<CreditPurchaseRow | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const found = await tx.execute<CreditPurchaseRow & { provider_ref: string | null }>(sql`
      select id, pack_code, credits, price_aud::text as price_aud, status::text as status,
             provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at,
             provider_ref
        from credit_purchases
       where id = ${purchaseId} and tenant_id = current_tenant_id()
       for update
    `);
    const purchase = found.rows[0];
    if (!purchase) return null;
    // A payment through a session this purchase did not open (or a second
    // one): money taken that this order does not account for. Refused, not
    // granted; someone must refund it (review M1).
    if (purchase.provider_ref !== null && purchase.provider_ref !== providerRef) {
      throw new DuplicateCreditPaymentError(purchase.status, purchase.provider_ref);
    }
    const { provider_ref: _ref, ...row } = purchase;
    // A retry. Return it unchanged — see (2) above; an error here would make
    // the processor retry indefinitely.
    if (row.status === 'paid') return row;
    if (row.status !== 'pending') throw new CreditPurchaseNotPendingError(row.status);

    const grantId = randomUUID();
    await tx.execute(sql`
      insert into usage_grants (id, tenant_id, metric, amount, remaining, source)
      values (${grantId}, current_tenant_id(), 'scans', ${purchase.credits}, ${purchase.credits}, 'topup_pack')
    `);
    const updated = await tx.execute<CreditPurchaseRow>(sql`
      update credit_purchases
         set status = 'paid',
             paid_at = now(),
             grant_id = ${grantId},
             provider = ${provider}::billing_provider,
             provider_ref = ${providerRef},
             payment_ref = ${paymentRef}
       where id = ${purchaseId} and tenant_id = current_tenant_id()
      returning id, pack_code, credits, price_aud::text as price_aud, status::text as status,
                provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at
    `);
    return updated.rows[0]!;
  });
}

/**
 * A refund at the processor takes the credits back (group task 7.5.a).
 *
 * Matched to the payment it refunds (`payment_ref`): a refund of some other
 * payment takes nothing back. On a `paid` purchase it zeroes what is LEFT of
 * the grant and expires it, so a worker's give-back for an unreadable scan
 * cannot top a refunded pack up again; scans already spent stay spent. On a
 * `pending` one (the refund overtook the completion) it records the refund,
 * so the late completion finds it `refunded` and grants nothing. Idempotent
 * under the row lock. Returns null when there is no such purchase.
 */
export async function refundCreditPurchaseFromProvider(
  userId: string,
  tenantId: string,
  purchaseId: string,
  paymentRef: string,
): Promise<{ status: string; clawedBack: number; otherPayment?: true } | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const found = await tx.execute<{ status: string; grant_id: string | null; payment_ref: string | null }>(sql`
      select status::text as status, grant_id, payment_ref
        from credit_purchases
       where id = ${purchaseId} and tenant_id = current_tenant_id()
       for update
    `);
    const purchase = found.rows[0];
    if (!purchase) return null;

    if (purchase.status === 'pending') {
      await tx.execute(sql`
        update credit_purchases
           set status = 'refunded', paid_at = now(), payment_ref = ${paymentRef}
         where id = ${purchaseId} and tenant_id = current_tenant_id()
      `);
      return { status: 'refunded', clawedBack: 0 };
    }
    if (purchase.payment_ref !== paymentRef) {
      return { status: purchase.status, clawedBack: 0, otherPayment: true };
    }
    if (purchase.status !== 'paid') return { status: purchase.status, clawedBack: 0 };

    const taken = await tx.execute<{ taken: number }>(sql`
      update usage_grants g
         set remaining = 0, expires_at = now()
        from (select id, remaining from usage_grants where id = ${purchase.grant_id} for update) old
       where g.id = old.id and g.tenant_id = current_tenant_id()
      returning old.remaining as taken
    `);
    await tx.execute(sql`
      update credit_purchases set status = 'refunded'
       where id = ${purchaseId} and tenant_id = current_tenant_id()
    `);
    return { status: 'refunded', clawedBack: taken.rows[0]?.taken ?? 0 };
  });
}

/**
 * A Google Play purchase the driver has verified becomes a paid purchase and
 * its grant, exactly once per purchase token (group plan 8.3.b).
 *
 * The token is the purchase's `provider_ref` under provider 'google', so
 * `credit_purchases_provider_ref_idx` (0024) holds it to one row across every
 * workspace. The insert is ON CONFLICT DO NOTHING: two concurrent calls with
 * the same token queue on that index and the second inserts nothing, so it
 * cannot grant. A repeat finds the row and returns it unchanged.
 *
 * Returns null for an unknown or retired pack, and 'other_workspace' when the
 * token is already recorded somewhere this workspace cannot see.
 */
export async function grantGooglePlayPurchase(
  userId: string,
  tenantId: string,
  packCode: string,
  purchaseToken: string,
  paymentRef: string,
): Promise<{ row: CreditPurchaseRow; granted: boolean } | 'other_workspace' | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const pack = await tx.execute<{ code: string; credits: number; price_aud: string }>(sql`
      select code, credits, price_aud::text as price_aud from credit_packs where code = ${packCode} and active = true
    `);
    const p = pack.rows[0];
    if (!p) return null;

    const purchaseId = randomUUID();
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider, provider_ref)
      values (${purchaseId}, current_tenant_id(), ${userId}, ${p.code}, ${p.credits}, ${p.price_aud}, 'pending', 'google', ${purchaseToken})
      on conflict (provider, provider_ref) where provider_ref is not null do nothing
      returning id
    `);
    const columns = sql`id, pack_code, credits, price_aud::text as price_aud, status::text as status,
      provider::text as provider, to_json(created_at)#>>'{}' as created_at, to_json(paid_at)#>>'{}' as paid_at`;

    if (inserted.rows.length === 0) {
      const existing = await tx.execute<CreditPurchaseRow>(sql`
        select ${columns} from credit_purchases
         where provider = 'google' and provider_ref = ${purchaseToken} and tenant_id = current_tenant_id()
      `);
      return existing.rows[0] ? { row: existing.rows[0], granted: false } : 'other_workspace';
    }

    const grantId = randomUUID();
    await tx.execute(sql`
      insert into usage_grants (id, tenant_id, metric, amount, remaining, source)
      values (${grantId}, current_tenant_id(), 'scans', ${p.credits}, ${p.credits}, 'topup_pack')
    `);
    const paid = await tx.execute<CreditPurchaseRow>(sql`
      update credit_purchases
         set status = 'paid', paid_at = now(), grant_id = ${grantId}, payment_ref = ${paymentRef}
       where id = ${purchaseId} and tenant_id = current_tenant_id()
      returning ${columns}
    `);
    return { row: paid.rows[0]!, granted: true };
  });
}

/**
 * A Google Play void for a token we hold no purchase for (review L3): it was
 * never redeemed, or a redeem is between Google's "purchased" and its insert.
 * Records the token as a `refunded` purchase with no grant, so that late
 * redeem conflicts on the token index and grants nothing, as the Stripe
 * pending-refund path does. 'exists' when a row for the token is already
 * there (a redeem committed meanwhile: the caller refunds that row instead);
 * null for a pack that is not in the catalogue, which no redeem can grant.
 */
export async function recordGooglePlayVoid(
  userId: string,
  tenantId: string,
  packCode: string,
  purchaseToken: string,
  paymentRef: string,
): Promise<'recorded' | 'exists' | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const pack = await tx.execute<{ code: string; credits: number; price_aud: string }>(sql`
      select code, credits, price_aud::text as price_aud from credit_packs where code = ${packCode}
    `);
    const p = pack.rows[0];
    if (!p) return null;
    // Waits on the token index for an uncommitted redeem, then conflicts.
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider,
                                    provider_ref, payment_ref, paid_at)
      values (${randomUUID()}, current_tenant_id(), ${userId}, ${p.code}, ${p.credits}, ${p.price_aud}, 'refunded',
              'google', ${purchaseToken}, ${paymentRef}, now())
      on conflict (provider, provider_ref) where provider_ref is not null do nothing
      returning id
    `);
    return inserted.rows.length ? 'recorded' : 'exists';
  });
}

/** The purchase a processor reference belongs to, in this workspace. */
export async function findCreditPurchaseByProviderRef(
  userId: string,
  tenantId: string,
  provider: 'google',
  providerRef: string,
): Promise<{ id: string; payment_ref: string | null } | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const found = await tx.execute<{ id: string; payment_ref: string | null }>(sql`
      select id, payment_ref from credit_purchases
       where provider = ${provider}::billing_provider and provider_ref = ${providerRef}
         and tenant_id = current_tenant_id()
    `);
    return found.rows[0] ?? null;
  });
}

/**
 * Ties a just-opened checkout session to its purchase: one session per
 * purchase (review M1). False when the purchase is no longer pending or
 * already has one; the caller then refuses and never shows the new session.
 */
export async function attachCheckoutSession(
  userId: string,
  tenantId: string,
  purchaseId: string,
  provider: 'stripe',
  providerRef: string,
): Promise<boolean> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const updated = await tx.execute<{ id: string }>(sql`
      update credit_purchases
         set provider = ${provider}::billing_provider, provider_ref = ${providerRef}
       where id = ${purchaseId} and tenant_id = current_tenant_id()
         and status = 'pending' and provider_ref is null
      returning id
    `);
    return updated.rows.length > 0;
  });
}

/**
 * The workspace's time zone, from its country: Indonesia is Jakarta, anywhere
 * else (Australia) Sydney. ponytail: one zone a country; Perth is 2–3 hours
 * off, which only moves a scan made in the first hours of the 1st.
 */
const workspaceZone = sql`(select case t.country when 'ID' then 'Asia/Jakarta' else 'Australia/Sydney' end
                             from tenants t where t.id = current_tenant_id())`;

export type UsageRow = {
  id: string;
  label: string;
  occurred_at: string;
  amount: number;
  refunded: boolean;
};

/**
 * One month of scan credits spent (7.1.e), newest first, from `credit_spends`
 * (0039). A spend that took a credit counts 1; one given back (7.1.c), or one
 * from before 7.1.b that found no credit, counts 0 and stays listed so the
 * month reads true. `total` is over the whole month; `items` is one page,
 * continued with `before` = the last item's id.
 *
 * Months are the workspace's, by its country (`workspaceZone`), whatever the
 * database session's time zone.
 *
 * Teen scans are paid from the parent's workspace and recorded in
 * `teen_space_spends`, which the API cannot read; 0056 fills
 * the gap (a flag on the teen's own spend row, and a definer read for the
 * parent). In a teen space a scan paid by the parent counts 1 credit; in the
 * parent's workspace, for its owner only, each credit a teen's scan took is a "Teen scan" line (no
 * supplier: what the receipt held stays in the teen's space).
 */
export async function listCreditUsage(
  userId: string,
  tenantId: string,
  month: string,
  limit: number,
  before: string | null,
): Promise<{ total: number; items: UsageRow[]; nextBefore: string | null }> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    // `timestamp at time zone` reads the local date in the workspace's zone;
    // a `date` would first be cast through the session's.
    const local = sql`${`${month}-01`}::timestamp`;
    const from = sql`(${local} at time zone ${workspaceZone})`;
    const to = sql`((${local} + interval '1 month') at time zone ${workspaceZone})`;
    // This workspace's spends plus the teen scans it paid for, in one list.
    const spends = sql`
      with sp as (
        select s.id, s.capture_id, s.spent_at,
               (s.refunded_at is null
                and (s.grant_source is not null or s.parent_funded))::int as amount,
               s.refunded_at is not null as refunded, false as teen
          from credit_spends s
         where s.spent_at >= ${from} and s.spent_at < ${to}
        union all
        select f.id, null::uuid, f.spent_at, (not f.refunded)::int, f.refunded, true
          from teen_space_funded_spends(${from}, ${to}) f
      )`;
    const total = await tx.execute<{ n: number }>(sql`
      ${spends} select coalesce(sum(amount), 0)::int as n from sp
    `);
    const rows = await tx.execute<UsageRow>(sql`
      ${spends}
      select s.id,
             case when s.teen then 'Teen scan' else coalesce(sup.legal_name, 'Scan') end as label,
             to_json(s.spent_at)#>>'{}' as occurred_at,
             s.amount,
             s.refunded
        from sp s
        left join lateral (
          select p.legal_name from documents d join parties p on p.id = d.supplier_id
           where d.capture_id = s.capture_id
             -- Another member's private receipt keeps its detail (0012).
             and (d.visibility = 'shared' or d.created_by = current_user_id())
           limit 1
        ) sup on true
       where (${before}::uuid is null
              or (s.spent_at, s.id) < (select b.spent_at, b.id from sp b where b.id = ${before}::uuid))
       order by s.spent_at desc, s.id desc
       limit ${limit + 1}
    `);
    const items = rows.rows.slice(0, limit);
    return {
      total: total.rows[0]?.n ?? 0,
      items,
      nextBefore: rows.rows.length > limit ? items[items.length - 1]!.id : null,
    };
  });
}

/** The months (`YYYY-MM`, the workspace's, newest first) with any scan spend in them. */
export async function listCreditUsageMonths(userId: string, tenantId: string): Promise<string[]> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const rows = await tx.execute<{ month: string }>(sql`
      select distinct to_char(t at time zone ${workspaceZone}, 'YYYY-MM') as month
        from (select spent_at as t from credit_spends
              union all select spent_at from teen_space_funded_spends(null, null)) m
       order by month desc
    `);
    return rows.rows.map((r) => r.month);
  });
}
