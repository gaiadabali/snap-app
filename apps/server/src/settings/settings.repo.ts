import { randomUUID } from 'node:crypto';

import { withTenantAs, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * Categories, and the defaults a new workspace starts with.
 *
 * A category is never deleted — `document_lines.category_id` points at it from
 * every receipt it has ever categorised, and those are records with a five-year
 * retention obligation. Retiring it (`active = false`) is the operation the
 * product actually needs: stop offering it, change nothing that already uses it.
 */

const tx = withTenantAs;

/**
 * What a workspace starts with, by kind.
 *
 * A household and a haulage business are not the same list with different
 * labels: one is heading for a BAS and a tax return and needs ATO deduction
 * codes, the other only has to answer "is this month going to hold?". Offering
 * a household "D1 — car expenses" is how a personal tracker becomes the
 * complicated business one it was meant to be simpler than.
 */
const DEFAULTS = {
  business: [
    { name: 'Fuel', code: 'D1' },
    { name: 'Vehicle running costs', code: 'D1' },
    { name: 'Tolls and parking', code: 'D1' },
    { name: 'Travel and accommodation', code: 'D2' },
    { name: 'Meals while travelling', code: 'D2' },
    { name: 'Tools and equipment', code: 'D5' },
    { name: 'Protective clothing', code: 'D3' },
    { name: 'Phone and internet', code: 'D5' },
    { name: 'Training and licences', code: 'D4' },
    { name: 'Repairs and maintenance', code: null },
    { name: 'Insurance', code: null },
    { name: 'Office and admin', code: 'D5' },
  ],
  personal: [
    { name: 'Groceries', code: null },
    { name: 'Eating out', code: null },
    { name: 'Transport', code: null },
    { name: 'Fuel', code: null },
    { name: 'Bills & utilities', code: null },
    { name: 'Health', code: null },
    { name: 'Shopping', code: null },
    { name: 'Home', code: null },
    { name: 'Fun', code: null },
  ],
} as const;

/**
 * Gives a new workspace something to categorise with.
 *
 * `ON CONFLICT DO NOTHING`, so calling it twice is harmless and a category the
 * user has renamed or retired is never resurrected.
 */
export async function seedDefaultCategories(
  userId: string,
  tenantId: string,
  kind: 'business' | 'personal',
): Promise<void> {
  const rows = DEFAULTS[kind];
  await tx(getDb(), userId, tenantId, async (t) => {
    for (const row of rows) {
      await t.execute(sql`
        insert into categories (id, tenant_id, name, ato_deduction_code)
        values (${randomUUID()}, ${tenantId}, ${row.name}, ${row.code})
        on conflict (tenant_id, name) do nothing
      `);
    }
  });
}

export type CategoryRow = {
  name: string;
  tax_label: string | null;
  monthly_budget: string | null;
  document_count: number;
  total_spend: string;
  active: boolean;
};

/**
 * Every category with what has actually been spent against it.
 *
 * The counts come from `document_lines`, not from documents: a single Bunnings
 * docket can legitimately span two categories, and counting it once against
 * whichever one happened to be first would misstate both.
 */
export async function listCategories(
  userId: string,
  tenantId: string,
): Promise<CategoryRow[]> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<CategoryRow>(sql`
      select c.name,
             c.ato_deduction_code as tax_label,
             b.monthly::text      as monthly_budget,
             coalesce(u.document_count, 0)::int  as document_count,
             -- Cast through the money domain, not straight to text: a bare 0
             -- renders as '0' while every other amount in the app is 4dp, and
             -- a client comparing strings would see two different zeroes.
             coalesce(u.total_spend, 0)::numeric(18,4)::text as total_spend,
             c.active
        from categories c
        left join budgets b on b.tenant_id = c.tenant_id and b.category = c.name
        left join (
          select l.category_id,
                 count(distinct l.document_id) as document_count,
                 sum(l.line_net_amount)        as total_spend
            from document_lines l
            join documents d on d.id = l.document_id
           where d.deleted_at is null and d.review_status <> 'rejected'
           group by l.category_id
        ) u on u.category_id = c.id
       order by c.name
    `);
    return rows.rows;
  });
}

/** Retires or restores a category. Never deletes one. */
export async function setCategoryActive(
  userId: string,
  tenantId: string,
  name: string,
  active: boolean,
): Promise<boolean> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ name: string }>(sql`
      update categories set active = ${active}
       where tenant_id = ${tenantId} and name = ${name}
       returning name
    `);
    return rows.rows.length > 0;
  });
}

export async function createCategory(
  userId: string,
  tenantId: string,
  name: string,
  taxLabel: string | null,
): Promise<void> {
  await tx(getDb(), userId, tenantId, async (t) => {
    // A name that already exists comes back as a live category rather than an
    // error: to the user, adding "Fuel" when a retired "Fuel" exists means
    // they want to use it again.
    await t.execute(sql`
      insert into categories (id, tenant_id, name, ato_deduction_code)
      values (${randomUUID()}, ${tenantId}, ${name}, ${taxLabel})
      on conflict (tenant_id, name)
        do update set active = true,
                      ato_deduction_code = coalesce(${taxLabel}, categories.ato_deduction_code)
    `);
  });
}

/* ── Accounting connections ─────────────────────────────────────────────── */

export type ConnectionRow = {
  provider: string;
  external_tenant_id: string | null;
  connected_at: string | null;
  revoked_at: string | null;
};

export async function listConnections(
  userId: string,
  tenantId: string,
): Promise<{ connections: ConnectionRow[]; queued: number }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<ConnectionRow>(sql`
      select provider, external_tenant_id,
             created_at::text as connected_at, revoked_at::text as revoked_at
        from accounting_connections
       where revoked_at is null
       order by created_at desc
    `);
    // What would be pushed if a connection existed: everything reviewed and
    // not yet exported. Counted even when nothing is connected, because the
    // number is the reason to connect.
    const pending = await t.execute<{ n: number }>(sql`
      select count(*)::int as n from documents
       where deleted_at is null and review_status in ('reviewed', 'auto_accepted')
    `);
    return { connections: rows.rows, queued: pending.rows[0]?.n ?? 0 };
  });
}

/* ── The tax pack ───────────────────────────────────────────────────────── */

export type PackSection = {
  label: string;
  detail: string;
  count: number;
  bytes: number;
};

/**
 * What an export would contain, measured rather than estimated.
 *
 * `bytes` is the real stored size of the original captures. A size a user is
 * about to wait on a download for should not be a guess.
 */
export async function readTaxPack(
  userId: string,
  tenantId: string,
  fromDate: string,
  toDate: string,
): Promise<PackSection[]> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      label: string;
      count: number;
      bytes: string;
    }>(sql`
      with scoped as (
        select d.id, d.is_tax_invoice, c.original_byte_size
          from documents d
          left join captures c on c.id = d.capture_id
         where d.deleted_at is null
           and d.review_status <> 'rejected'
           and d.issue_date between ${fromDate}::date and ${toDate}::date
      )
      select 'Tax invoices' as label,
             count(*) filter (where is_tax_invoice)::int as count,
             coalesce(sum(original_byte_size) filter (where is_tax_invoice), 0)::text as bytes
        from scoped
      union all
      select 'Receipts under $82.50',
             count(*) filter (where not is_tax_invoice)::int,
             coalesce(sum(original_byte_size) filter (where not is_tax_invoice), 0)::text
        from scoped
    `);

    const trips = await t.execute<{ n: number; km: string }>(sql`
      select count(*)::int as n, coalesce(sum(km), 0)::text as km
        from trips
       where work_related and trip_date between ${fromDate}::date and ${toDate}::date
    `);
    const trip = trips.rows[0];

    return [
      ...rows.rows.map((r) => ({
        label: r.label,
        detail:
          r.label === 'Tax invoices'
            ? 'The original image of each, as captured. An electronic copy is acceptable to the ATO only if it is a true and clear reproduction.'
            : 'Below the $82.50 threshold, so a tax invoice was never required — but the GST on them cannot be claimed.',
        count: r.count,
        bytes: Number(r.bytes),
      })),
      {
        label: 'Trip log',
        detail: `${trip?.km ?? '0'} work kilometres. A CSV, not an image — there is no original to reproduce.`,
        count: trip?.n ?? 0,
        // Roughly 80 bytes a row; the only figure here that is an estimate,
        // and it is one nobody is waiting on a download for.
        bytes: (trip?.n ?? 0) * 80,
      },
    ];
  });
}

export type { Tx };

/**
 * Revokes a connection.
 *
 * Marked revoked rather than deleted: which software a workspace was linked to
 * and when it stopped is part of the audit trail, and "we never had one" and
 * "we disconnected in March" are different answers to an accountant.
 */
export async function revokeConnection(
  userId: string,
  tenantId: string,
  provider: string,
): Promise<boolean> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ id: string }>(sql`
      update accounting_connections
         set revoked_at = now()
       where tenant_id = ${tenantId}
         and provider = ${provider}
         and revoked_at is null
       returning id
    `);
    return rows.rows.length > 0;
  });
}
