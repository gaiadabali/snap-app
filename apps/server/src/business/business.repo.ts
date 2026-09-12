import { randomUUID } from 'node:crypto';

import { money, withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * The business and personal side, in SQL.
 *
 * Two rules, the same as everywhere else in this server:
 *
 *  1. Every query runs inside `withTenantAs`, which proves membership in the
 *     same transaction before any tenant context exists.
 *  2. Money is computed in SQL or by `@snap/db`'s exact-decimal helpers, never
 *     in JavaScript floating point. `amount_due` below is a NUMERIC
 *     subtraction performed by Postgres, which is the only participant here
 *     that can be trusted with a cent.
 */

const tx = withTenantAs;

/* ── Invoices ───────────────────────────────────────────────────────────── */

export type InvoiceRow = {
  id: string;
  number: string;
  kind: string;
  status: string;
  party_id: string;
  party_name: string;
  issue_date: string;
  due_date: string;
  net_amount: string;
  gst_amount: string;
  total_amount: string;
  amount_paid: string;
  amount_due: string;
};

/**
 * Invoices with what is actually owed on each.
 *
 * `amount_paid` is summed from `payments` rather than stored on the invoice.
 * A stored balance and a payment history are two sources for one fact, and
 * they diverge the first time a payment is voided.
 *
 * `status` is derived for everything except a draft: a draft stays a draft
 * because nobody has been asked to pay it, and calling it "sent" would tell a
 * user their invoice went to a customer when it did not.
 */
export async function listInvoices(
  userId: string,
  tenantId: string,
  kind?: 'invoice' | 'estimate',
): Promise<InvoiceRow[]> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<InvoiceRow>(sql`
      with paid as (
        select invoice_id, coalesce(sum(amount), 0)::numeric(18,4)::text as amount_paid
          from payments group by invoice_id
      )
      select i.id, i.number, i.kind::text as kind,
             case
               when i.status = 'draft' then 'draft'
               when coalesce(paid.amount_paid::numeric, 0) >= i.total_amount then 'paid'
               when i.due_date < current_date then 'overdue'
               else 'sent'
             end as status,
             i.party_id, p.legal_name as party_name,
             i.issue_date::text as issue_date, i.due_date::text as due_date,
             i.net_amount::text, i.gst_amount::text, i.total_amount::text,
             coalesce(paid.amount_paid::numeric, 0)::numeric(18,4)::text as amount_paid,
             case when i.status = 'draft' then i.total_amount::text
                  else greatest(i.total_amount - coalesce(paid.amount_paid::numeric, 0), 0)::text
             end as amount_due
        from invoices i
        join parties p on p.id = i.party_id
        left join paid on paid.invoice_id = i.id
       where i.voided_at is null
         and (${kind ?? null}::text is null or i.kind::text = ${kind ?? null})
       order by i.issue_date desc, i.number desc
    `);
    return rows.rows;
  });
}

export type InvoiceLineRow = {
  line_number: number;
  item_id: string | null;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  net_amount: string;
  gst_amount: string;
  total_amount: string;
};

export async function getInvoice(
  userId: string,
  tenantId: string,
  invoiceId: string,
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] } | null> {
  const all = await listInvoices(userId, tenantId);
  const invoice = all.find((i) => i.id === invoiceId);
  if (!invoice) return null;
  const lines = await tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<InvoiceLineRow>(sql`
      select line_number, item_id, description, unit, quantity::text,
             unit_price::text, net_amount::text, gst_amount::text, total_amount::text
        from invoice_lines where invoice_id = ${invoiceId} order by line_number
    `);
    return rows.rows;
  });
  return { invoice, lines };
}

/**
 * Copies an estimate into a draft invoice.
 *
 * GST is recomputed from the lines rather than copied: a quote may be months
 * old, and what matters to the ATO is the tax on what was actually billed.
 * The estimate is untouched — it is what the customer agreed to.
 */
export async function convertEstimate(
  userId: string,
  tenantId: string,
  estimateId: string,
): Promise<{ id: string } | { error: 'not_found' | 'not_an_estimate' | 'already_converted' }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const found = await t.execute<{ id: string; kind: string; party_id: string }>(sql`
      select id, kind::text as kind, party_id from invoices where id = ${estimateId} limit 1
    `);
    const estimate = found.rows[0];
    if (!estimate) return { error: 'not_found' as const };
    if (estimate.kind !== 'estimate') return { error: 'not_an_estimate' as const };

    const existing = await t.execute<{ id: string }>(sql`
      select id from invoices where converted_from = ${estimateId} limit 1
    `);
    if (existing.rows[0]) return { error: 'already_converted' as const };

    // The invoice series continues; estimates have their own. A customer's
    // accounts department reconciles against INV-, and a gap is a question.
    const next = await t.execute<{ n: number }>(sql`
      select coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::int), 1000) + 1 as n
        from invoices where kind = 'invoice'
    `);
    const number = `INV-${next.rows[0]?.n ?? 1001}`;
    const invoiceId = randomUUID();

    await t.execute(sql`
      insert into invoices (
        id, tenant_id, number, kind, status, party_id, issue_date, due_date,
        net_amount, gst_amount, total_amount, converted_from, created_by
      )
      select ${invoiceId}, ${tenantId}, ${number}, 'invoice', 'draft', party_id,
             current_date, current_date + 14,
             net_amount, round(net_amount * 0.1, 4), net_amount + round(net_amount * 0.1, 4),
             ${estimateId}, ${userId}
        from invoices where id = ${estimateId}
    `);

    await t.execute(sql`
      insert into invoice_lines (
        id, tenant_id, invoice_id, line_number, item_id, description, unit,
        quantity, unit_price, net_amount, gst_amount, total_amount
      )
      select gen_random_uuid(), ${tenantId}, ${invoiceId}, line_number, item_id,
             description, unit, quantity, unit_price,
             net_amount, round(net_amount * 0.1, 4), net_amount + round(net_amount * 0.1, 4)
        from invoice_lines where invoice_id = ${estimateId}
    `);

    return { id: invoiceId };
  });
}

/* ── Payments ───────────────────────────────────────────────────────────── */

export async function listPayments(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      invoice_id: string;
      invoice_number: string;
      party_name: string;
      paid_on: string;
      amount: string;
      method: string;
      reference: string | null;
    }>(sql`
      select pay.id, pay.invoice_id, i.number as invoice_number, p.legal_name as party_name,
             pay.paid_on::text as paid_on, pay.amount::text as amount,
             pay.method::text as method, pay.reference
        from payments pay
        join invoices i on i.id = pay.invoice_id
        join parties p on p.id = i.party_id
       order by pay.paid_on desc, pay.created_at desc
    `);
    return rows.rows;
  });
}

export async function recordPayment(
  userId: string,
  tenantId: string,
  invoiceId: string,
  amount: string,
  method: string,
  reference?: string,
): Promise<{ id: string } | { error: 'not_found' | 'too_much'; due?: string }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    // Locked for the duration: two payments recorded at once could each see
    // the same balance and together exceed the invoice.
    const found = await t.execute<{ total: string; paid: string }>(sql`
      select i.total_amount::text as total,
             coalesce((select sum(amount) from payments where invoice_id = i.id), 0)::numeric(18,4)::text as paid
        from invoices i where i.id = ${invoiceId} for update
    `);
    const invoice = found.rows[0];
    if (!invoice) return { error: 'not_found' as const };

    const due = money.subtract(money.money(invoice.total), money.money(invoice.paid));
    if (Number(amount) > Number(due) + 0.005) {
      return { error: 'too_much' as const, due };
    }

    const id = randomUUID();
    await t.execute(sql`
      insert into payments (id, tenant_id, invoice_id, paid_on, amount, method, reference, recorded_by)
      values (${id}, ${tenantId}, ${invoiceId}, current_date, ${amount}, ${method}::payment_method,
              ${reference ?? null}, ${userId})
    `);
    return { id };
  });
}

/* ── Bills ──────────────────────────────────────────────────────────────── */

export async function listBills(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      supplier_name: string | null;
      reference: string | null;
      issue_date: string;
      due_date: string;
      total_amount: string;
      gst_amount: string;
      amount_paid: string;
      amount_due: string;
      status: string;
      category: string | null;
    }>(sql`
      select b.id, p.legal_name as supplier_name, b.reference,
             b.issue_date::text, b.due_date::text,
             b.total_amount::text, b.gst_amount::text, b.amount_paid::text,
             (b.total_amount - b.amount_paid)::text as amount_due,
             case
               when b.amount_paid >= b.total_amount then 'paid'
               when b.due_date < current_date then 'overdue'
               else 'unpaid'
             end as status,
             b.category
        from bills b
        left join parties p on p.id = b.supplier_id
       where b.status <> 'void'
       order by b.due_date
    `);
    return rows.rows;
  });
}

export async function payBill(
  userId: string,
  tenantId: string,
  billId: string,
  amount?: string,
): Promise<{ ok: true } | { error: 'not_found' | 'too_much'; due?: string }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const found = await t.execute<{ total: string; paid: string }>(sql`
      select total_amount::text as total, amount_paid::text as paid
        from bills where id = ${billId} for update
    `);
    const bill = found.rows[0];
    if (!bill) return { error: 'not_found' as const };

    const due = money.subtract(money.money(bill.total), money.money(bill.paid));
    const paying = amount ?? due;
    if (Number(paying) > Number(due) + 0.005) return { error: 'too_much' as const, due };

    await t.execute(sql`
      update bills
         set amount_paid = amount_paid + ${paying},
             -- A part payment does not clear an overdue bill: it is still late.
             status = case when amount_paid + ${paying} >= total_amount then 'paid'::bill_status
                           else status end,
             updated_at = now()
       where id = ${billId}
    `);
    return { ok: true as const };
  });
}

/* ── Items and stock ────────────────────────────────────────────────────── */

export async function listItems(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      name: string;
      sku: string | null;
      unit: string;
      sell_price: string;
      cost_price: string;
      stock_on_hand: string | null;
      low_stock: boolean;
      tax_code: string;
    }>(sql`
      select id, name, sku, unit, sell_price::text, cost_price::text,
             stock_on_hand::text,
             (stock_on_hand is not null and stock_on_hand <= low_stock_at) as low_stock,
             tax_code
        from items where active order by name
    `);
    return rows.rows;
  });
}

export async function createItem(
  userId: string,
  tenantId: string,
  item: {
    name: string;
    sku?: string | null;
    unit: string;
    sellPrice: string;
    costPrice: string;
    stockOnHand: number | null;
    taxCode: string;
  },
): Promise<{ id: string } | { error: 'duplicate_sku' }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    if (item.sku) {
      const clash = await t.execute<{ id: string }>(sql`
        select id from items where sku = ${item.sku} limit 1
      `);
      if (clash.rows[0]) return { error: 'duplicate_sku' as const };
    }
    const id = randomUUID();
    await t.execute(sql`
      insert into items (id, tenant_id, name, sku, unit, sell_price, cost_price, stock_on_hand, tax_code)
      values (${id}, ${tenantId}, ${item.name}, ${item.sku ?? null}, ${item.unit},
              ${item.sellPrice}, ${item.costPrice}, ${item.stockOnHand}, ${item.taxCode})
    `);
    return { id };
  });
}

/**
 * Records a stock take.
 *
 * The count is written as a MOVEMENT carrying the difference, and the balance
 * follows from it. Overwriting the number directly would discard exactly the
 * information a stock take exists to produce: how far out the records were.
 */
export async function countStock(
  userId: string,
  tenantId: string,
  itemId: string,
  counted: number,
): Promise<{ difference: number } | { error: 'not_found' | 'is_a_service' }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const found = await t.execute<{ stock: string | null }>(sql`
      select stock_on_hand::text as stock from items where id = ${itemId} for update
    `);
    const item = found.rows[0];
    if (!item) return { error: 'not_found' as const };
    if (item.stock === null) return { error: 'is_a_service' as const };

    const difference = counted - Number(item.stock);
    await t.execute(sql`update items set stock_on_hand = ${counted}, updated_at = now() where id = ${itemId}`);
    await t.execute(sql`
      insert into stock_movements (id, tenant_id, item_id, kind, quantity, note, by_user)
      values (${randomUUID()}, ${tenantId}, ${itemId}, 'count', ${difference},
              ${difference === 0 ? 'Counted, no change' : 'Stock take'}, ${userId})
    `);
    return { difference };
  });
}

export async function listStockMovements(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      item_id: string;
      item_name: string;
      kind: string;
      quantity: string;
      at: string;
      note: string | null;
      by_name: string | null;
    }>(sql`
      select m.id, m.item_id, i.name as item_name, m.kind::text as kind,
             m.quantity::text as quantity, m.at::text as at, m.note,
             u.display_name as by_name
        from stock_movements m
        join items i on i.id = m.item_id
        left join users u on u.id = m.by_user
       order by m.at desc limit 100
    `);
    return rows.rows;
  });
}

/* ── Trips ──────────────────────────────────────────────────────────────── */

export async function listTrips(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      trip_date: string;
      from_place: string;
      to_place: string;
      km: string;
      purpose: string | null;
      work_related: boolean;
      source: string;
    }>(sql`
      select id, trip_date::text, from_place, to_place, km::text, purpose,
             work_related, source
        from trips order by trip_date desc, created_at desc
    `);
    return rows.rows;
  });
}

export async function addTrip(
  userId: string,
  tenantId: string,
  trip: {
    date: string;
    fromPlace: string;
    toPlace: string;
    km: number;
    purpose: string;
    workRelated: boolean;
    source: string;
  },
): Promise<{ id: string }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const id = randomUUID();
    await t.execute(sql`
      insert into trips (id, tenant_id, trip_date, from_place, to_place, km, purpose, work_related, source, created_by)
      values (${id}, ${tenantId}, ${trip.date}::date, ${trip.fromPlace}, ${trip.toPlace},
              ${trip.km}, ${trip.purpose}, ${trip.workRelated}, ${trip.source}, ${userId})
    `);
    return { id };
  });
}

export async function deleteTrip(userId: string, tenantId: string, tripId: string): Promise<void> {
  await tx(getDb(), userId, tenantId, async (t) => {
    await t.execute(sql`delete from trips where id = ${tripId}`);
  });
}

/* ── Budgets and goals ──────────────────────────────────────────────────── */

export async function listBudgets(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{ category: string; monthly: string }>(sql`
      select category, monthly::text from budgets order by category
    `);
    return rows.rows;
  });
}

export async function setBudget(
  userId: string,
  tenantId: string,
  category: string,
  monthly: string,
): Promise<void> {
  await tx(getDb(), userId, tenantId, async (t) => {
    await t.execute(sql`
      insert into budgets (tenant_id, category, monthly)
      values (${tenantId}, ${category}, ${monthly})
      on conflict (tenant_id, category)
        do update set monthly = excluded.monthly, updated_at = now()
    `);
  });
}

export async function listGoals(userId: string, tenantId: string) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      name: string;
      target: string;
      saved: string;
      target_date: string | null;
    }>(sql`
      select id, name, target::text, saved::text, target_date::text
        from goals order by created_at
    `);
    return rows.rows;
  });
}

export async function createGoal(
  userId: string,
  tenantId: string,
  name: string,
  target: string,
  targetDate: string | null,
): Promise<{ id: string }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const id = randomUUID();
    await t.execute(sql`
      insert into goals (id, tenant_id, name, target, target_date)
      values (${id}, ${tenantId}, ${name}, ${target}, ${targetDate}::date)
    `);
    return { id };
  });
}

export async function contributeToGoal(
  userId: string,
  tenantId: string,
  goalId: string,
  amount: string,
): Promise<void> {
  await tx(getDb(), userId, tenantId, async (t) => {
    await t.execute(sql`
      update goals set saved = saved + ${amount}, updated_at = now() where id = ${goalId}
    `);
  });
}

export async function deleteGoal(userId: string, tenantId: string, goalId: string): Promise<void> {
  await tx(getDb(), userId, tenantId, async (t) => {
    await t.execute(sql`delete from goals where id = ${goalId}`);
  });
}

/* ── Parties ────────────────────────────────────────────────────────────── */

export async function listParties(
  userId: string,
  tenantId: string,
  kind?: 'customer' | 'supplier',
) {
  return tx(getDb(), userId, tenantId, async (t) => {
    const rows = await t.execute<{
      id: string;
      name: string;
      kind: string;
      abn: string | null;
      abn_valid: boolean | null;
      email: string | null;
      phone: string | null;
      open_balance: string;
      invoice_count: number;
    }>(sql`
      select p.id, p.legal_name as name, p.kind::text as kind, p.abn, p.abn_valid,
             p.email, p.phone,
             coalesce((
               select sum(i.total_amount - coalesce((
                 select sum(amount) from payments where invoice_id = i.id), 0))
                 from invoices i
                where i.party_id = p.id and i.status <> 'draft' and i.voided_at is null
             ), 0)::text as open_balance,
             (select count(*) from invoices i where i.party_id = p.id)::int as invoice_count
        from parties p
       where (${kind ?? null}::text is null
              or p.kind::text = ${kind ?? null} or p.kind = 'both')
       order by p.legal_name
    `);
    return rows.rows;
  });
}

export async function createParty(
  userId: string,
  tenantId: string,
  party: {
    name: string;
    kind: 'customer' | 'supplier';
    abn?: string | null;
    email?: string | null;
    phone?: string | null;
  },
): Promise<{ id: string }> {
  return tx(getDb(), userId, tenantId, async (t) => {
    const normalised = party.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const id = randomUUID();
    const inserted = await t.execute<{ id: string }>(sql`
      insert into parties (id, tenant_id, legal_name, name_normalised, kind, abn, email, phone)
      values (${id}, ${tenantId}, ${party.name}, ${normalised}, ${party.kind}::party_kind,
              ${party.abn ?? null}, ${party.email ?? null}, ${party.phone ?? null})
      on conflict (tenant_id, name_normalised, kind)
        do update set email = coalesce(excluded.email, parties.email),
                      phone = coalesce(excluded.phone, parties.phone)
      returning id
    `);
    return { id: inserted.rows[0]?.id ?? id };
  });
}
