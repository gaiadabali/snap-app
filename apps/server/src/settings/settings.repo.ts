import { randomUUID } from 'node:crypto';

import { withTenantAs, type Tx } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import {
  PERSONAL_DEDUCTION_CATEGORIES,
  defaultItemFor,
  isAtoLabel,
  isValidMapping,
} from './deduction-categories.js';

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
    // A personal workspace also starts with the work and rental categories that
    // feed a deduction bundle (docs/DEDUCTIONS.md). Migration 0042 backfills the
    // same list into workspaces that existed before it.
    if (kind === 'personal') {
      for (const row of PERSONAL_DEDUCTION_CATEGORIES) {
        if (!isValidMapping(row.label, row.itemId)) {
          throw new Error(`Seed category "${row.name}" maps to ${row.label}/${row.itemId}, which is not an FTR item.`);
        }
        await t.execute(sql`
          insert into categories (id, tenant_id, name, ato_deduction_code, engine_row_id, active)
          values (${randomUUID()}, ${tenantId}, ${row.name}, ${row.label}, ${row.itemId}, ${row.active})
          on conflict (tenant_id, name) do nothing
        `);
      }
    }
  });
}

export type CategoryRow = {
  id: string;
  name: string;
  tax_label: string | null;
  engine_row_id: string | null;
  private_use_percent: number | null;
  monthly_budget: string | null;
  document_count: number;
  total_spend: string;
  active: boolean;
  /** True when nothing points at this category — see `deleteCategory`. */
  deletable: boolean;
};

/**
 * Every category with what has actually been spent against it.
 *
 * The counts come from `document_lines`, not from documents: a single Bunnings
 * docket can legitimately span two categories, and counting it once against
 * whichever one happened to be first would misstate both. A line's category is
 * its own `category_id`, else its document's (`documents.category_id`, 0040:
 * the whole-receipt category a person or the supplier memory chose).
 *
 * `deletable` is computed here rather than from `document_count`, because
 * `document_count` deliberately excludes rejected and deleted documents (it is
 * a "what's live" figure for the screen) while a rejected document's line
 * still holds `document_lines.category_id` — deleting the category would still
 * violate that foreign key. `deletable` counts every reference, filtered or
 * not, which is the question that actually matters before offering the button.
 */
export async function listCategories(
  userId: string,
  tenantId: string,
): Promise<CategoryRow[]> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<CategoryRow>(sql`
      select c.id,
             c.name,
             c.ato_deduction_code as tax_label,
             c.engine_row_id,
             c.private_use_percent::int as private_use_percent,
             b.monthly::text      as monthly_budget,
             coalesce(u.document_count, 0)::int  as document_count,
             -- Cast through the money domain, not straight to text: a bare 0
             -- renders as '0' while every other amount in the app is 4dp, and
             -- a client comparing strings would see two different zeroes.
             coalesce(u.total_spend, 0)::numeric(18,4)::text as total_spend,
             c.active,
             (
               b.category is null
               and coalesce(refs.document_lines, 0) = 0
               and coalesce(refs.documents, 0) = 0
               and coalesce(refs.transaction_splits, 0) = 0
               and coalesce(refs.child_categories, 0) = 0
             ) as deletable
        from categories c
        left join budgets b on b.tenant_id = c.tenant_id and b.category = c.name
        left join (
          select coalesce(l.category_id, d.category_id) as category_id,
                 count(distinct l.document_id) as document_count,
                 sum(l.line_net_amount)        as total_spend
            from document_lines l
            join documents d on d.id = l.document_id
           where d.deleted_at is null and d.review_status <> 'rejected'
           group by coalesce(l.category_id, d.category_id)
        ) u on u.category_id = c.id
        left join lateral (
          select
            (select count(*) from document_lines dl where dl.category_id = c.id) as document_lines,
            (select count(*) from documents dd where dd.category_id = c.id) as documents,
            (select count(*) from transaction_splits ts where ts.category_id = c.id) as transaction_splits,
            (select count(*) from categories ch where ch.parent_id = c.id) as child_categories
        ) refs on true
       order by c.name
    `);
    return rows.rows;
  });
}

/** What is holding onto a category, in the terms the refusal message uses. */
export type CategoryUsage = {
  documentLines: number;
  documents: number;
  transactionSplits: number;
  childCategories: number;
  hasBudget: boolean;
};

/** One clause per kind of reference that is actually present, in a fixed order. */
function describeUsage(usage: CategoryUsage): string[] {
  const parts: string[] = [];
  if (usage.documentLines > 0) {
    parts.push(`${usage.documentLines} receipt line${usage.documentLines === 1 ? '' : 's'}`);
  }
  if (usage.documents > 0) {
    parts.push(`${usage.documents} receipt${usage.documents === 1 ? '' : 's'} filed under it`);
  }
  if (usage.transactionSplits > 0) {
    parts.push(
      `${usage.transactionSplits} ledger ${usage.transactionSplits === 1 ? 'entry' : 'entries'}`,
    );
  }
  if (usage.childCategories > 0) {
    parts.push(
      `${usage.childCategories} subcategor${usage.childCategories === 1 ? 'y' : 'ies'} nested under it`,
    );
  }
  if (usage.hasBudget) parts.push('a monthly budget');
  return parts;
}

export type DeleteCategoryResult =
  | { outcome: 'deleted' }
  | { outcome: 'not_found' }
  | { outcome: 'in_use'; reasons: string[] };

/**
 * Deletes a category — but ONLY when nothing points at it.
 *
 * `document_lines.category_id`, `transaction_splits.category_id` and a
 * category's own `parent_id` are real foreign keys with no `ON DELETE`
 * clause, so Postgres already refuses the bare DELETE below whenever one of
 * those exists (default action is `NO ACTION`/RESTRICT — nothing here relies
 * on cascading to make deletion "work"). `budgets.category` is NOT a foreign
 * key: a budget is matched to a category by NAME (see `listCategories`), so a
 * category with a budget would otherwise delete cleanly and leave a budget
 * row pointing at a name nothing answers to. That case is checked explicitly.
 *
 * All four are checked up front, in the same transaction as the delete, so
 * the refusal names every reason at once rather than surfacing whichever
 * foreign key Postgres happened to hit first.
 */
export async function deleteCategory(
  userId: string,
  tenantId: string,
  name: string,
): Promise<DeleteCategoryResult> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const found = await t.execute<{ id: string }>(sql`
      select id from categories where tenant_id = ${tenantId} and name = ${name}
    `);
    const cat = found.rows[0];
    if (!cat) return { outcome: 'not_found' as const };

    const usageRows = await t.execute<{
      document_lines: number;
      documents: number;
      transaction_splits: number;
      child_categories: number;
      has_budget: boolean;
    }>(sql`
      select
        (select count(*)::int from document_lines where category_id = ${cat.id}) as document_lines,
        (select count(*)::int from documents where category_id = ${cat.id}) as documents,
        (select count(*)::int from transaction_splits where category_id = ${cat.id}) as transaction_splits,
        (select count(*)::int from categories where parent_id = ${cat.id}) as child_categories,
        exists(select 1 from budgets where tenant_id = ${tenantId} and category = ${name}) as has_budget
    `);
    const row = usageRows.rows[0]!;
    const reasons = describeUsage({
      documentLines: row.document_lines,
      documents: row.documents,
      transactionSplits: row.transaction_splits,
      childCategories: row.child_categories,
      hasBudget: row.has_budget,
    });
    if (reasons.length > 0) return { outcome: 'in_use' as const, reasons };

    await t.execute(sql`delete from categories where tenant_id = ${tenantId} and id = ${cat.id}`);
    return { outcome: 'deleted' as const };
  });
}

export type CategoryPatch = {
  active?: boolean;
  /** A label from `ATO_LABELS`; null clears the mapping (label and item). */
  taxLabel?: string | null;
  /** Whole percent 0-99; null clears it. */
  privateUsePercent?: number | null;
};

/**
 * Changes a category: retire or restore it, give it (or take away) a tax
 * label, set its default private share. Never deletes one. `undefined` leaves a
 * field alone.
 *
 * A label is stored with the item it feeds. Setting a label, or changing it,
 * gives the label's default item (`DEFAULT_ITEM_FOR_LABEL`); setting the SAME
 * label on a category that already has an item keeps that item, so a seeded
 * "Work car: fuel" stays on `fuelReceiptTotal`. A legacy business category
 * with a label and no item gets the default item the first time its label is
 * written.
 *
 * Returns false when no category has that name.
 */
export async function updateCategory(
  userId: string,
  tenantId: string,
  name: string,
  patch: CategoryPatch,
): Promise<boolean> {
  return tx(getDb(), userId, tenantId, (t) => applyCategoryPatch(t, tenantId, name, patch));
}

async function applyCategoryPatch(
  t: Tx,
  tenantId: string,
  name: string,
  patch: CategoryPatch,
): Promise<boolean> {
  const found = await t.execute<{
    id: string;
    ato_deduction_code: string | null;
    engine_row_id: string | null;
  }>(sql`
    select id, ato_deduction_code, engine_row_id
      from categories where tenant_id = ${tenantId} and name = ${name}
       for update
  `);
  const cur = found.rows[0];
  if (!cur) return false;

  const labelGiven = patch.taxLabel !== undefined;
  let label = cur.ato_deduction_code;
  let item = cur.engine_row_id;
  if (labelGiven) {
    if (patch.taxLabel === null) {
      label = null;
      item = null;
    } else if (isAtoLabel(patch.taxLabel)) {
      if (patch.taxLabel !== cur.ato_deduction_code || item === null) {
        item = defaultItemFor(patch.taxLabel);
      }
      label = patch.taxLabel;
    } else {
      throw new Error(`Not an ATO label: ${patch.taxLabel}`);
    }
  }

  await t.execute(sql`
    update categories set
      active = coalesce(${patch.active ?? null}::boolean, active),
      ato_deduction_code = ${label},
      engine_row_id = ${item},
      private_use_percent = case when ${patch.privateUsePercent !== undefined}
        then ${patch.privateUsePercent ?? null}::smallint else private_use_percent end
     where tenant_id = ${tenantId} and id = ${cur.id}
  `);
  return true;
}

export async function createCategory(
  userId: string,
  tenantId: string,
  name: string,
  mapping: { taxLabel?: string | null; privateUsePercent?: number | null } = {},
): Promise<void> {
  await tx(getDb(), userId, tenantId, async (t) => {
    // A name that already exists comes back as a live category rather than an
    // error: to the user, adding "Fuel" when a retired "Fuel" exists means
    // they want to use it again. It keeps what it had unless the request names
    // a label or a private share; adding a name again never CLEARS a label.
    await t.execute(sql`
      insert into categories (id, tenant_id, name)
      values (${randomUUID()}, ${tenantId}, ${name})
      on conflict (tenant_id, name) do nothing
    `);
    await applyCategoryPatch(t, tenantId, name, {
      active: true,
      ...(mapping.taxLabel ? { taxLabel: mapping.taxLabel } : {}),
      ...(mapping.privateUsePercent !== undefined
        ? { privateUsePercent: mapping.privateUsePercent }
        : {}),
    });
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
