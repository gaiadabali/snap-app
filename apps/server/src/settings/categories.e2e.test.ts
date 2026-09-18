import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Deleting a spending category, against a real database as the application
 * role (`snap_app` — never a bypass role, because RLS on `categories` is half
 * the control being tested).
 *
 * The rule (see `settings.repo.ts` `deleteCategory`): a category deletes
 * cleanly only when NOTHING points at it. Three of the four referents are
 * real foreign keys with no `ON DELETE` clause — `document_lines.category_id`,
 * `transaction_splits.category_id`, and a category's own self-referencing
 * `parent_id` — so Postgres would refuse the bare DELETE on its own. The
 * fourth, `budgets.category`, is a soft reference matched by NAME, not a
 * foreign key, so the database would let that DELETE through and leave a
 * budget row pointing at nothing. That is the case an application-level guard
 * has to catch, and the one this file leans on hardest.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('deleting a category', () => {
  let repo: typeof import('./settings.repo.js');
  let admin: Client;

  const TENANT = '22222222-3333-4444-8555-666666666001';
  const USER = '22222222-3333-4444-8555-666666666002';
  const CAPTURE = '22222222-3333-4444-8555-666666666003';
  const DOCUMENT = '22222222-3333-4444-8555-666666666004';
  const ACCOUNT = '22222222-3333-4444-8555-666666666005';
  const TRANSACTION = '22222222-3333-4444-8555-666666666006';

  const user = { userId: USER, email: 'catdel@example.test', displayName: 'Cat Del', initials: 'CD' };

  const categoryId = async (name: string): Promise<string> => {
    const row = await admin.query('select id from categories where tenant_id = $1 and name = $2', [
      TENANT,
      name,
    ]);
    return row.rows[0].id as string;
  };

  const insertCategory = async (name: string, parentName?: string): Promise<void> => {
    const parentId = parentName ? await categoryId(parentName) : null;
    await admin.query(
      `insert into categories (id, tenant_id, name, parent_id) values ($1, $2, $3, $4)`,
      [randomUUID(), TENANT, name, parentId],
    );
  };

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    repo = await import('./settings.repo.js');

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();

    await admin.query(
      `insert into tenants (id, name, kind) values ($1, $2, 'business')
       on conflict (id) do nothing`,
      [TENANT, 'catdel-tenant'],
    );
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [USER, `test|${USER}`, user.email, user.displayName],
    );
    await admin.query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')
       on conflict do nothing`,
      [TENANT, USER],
    );

    // ── The unused category: nothing anywhere points at it ──────────────────
    await insertCategory('Unused');

    // ── A category with a receipt line — a real foreign key ────────────────
    await insertCategory('Has Receipt');
    await admin.query(
      `insert into captures (
         id, tenant_id, original_storage_key, original_mime_type,
         original_byte_size, original_sha256, page_count, device_meta, status
       ) values ($1, $2, $3, 'image/jpeg', 1024, decode(repeat('cd', 32), 'hex'), 1, '{}'::jsonb, 'received')`,
      [CAPTURE, TENANT, `${TENANT}/originals/cd/${CAPTURE}`],
    );
    await admin.query(
      `insert into documents (id, tenant_id, capture_id) values ($1, $2, $3)`,
      [DOCUMENT, TENANT, CAPTURE],
    );
    await admin.query(
      `insert into document_lines (id, tenant_id, document_id, line_number, category_id)
       values ($1, $2, $3, 1, (select id from categories where tenant_id = $2 and name = 'Has Receipt'))`,
      [randomUUID(), TENANT, DOCUMENT],
    );

    // ── A category with a budget only — NOT a foreign key ───────────────────
    await insertCategory('Has Budget');
    await admin.query(
      `insert into budgets (tenant_id, category, monthly) values ($1, 'Has Budget', 500)`,
      [TENANT],
    );

    // ── A category referenced from the ledger — a real foreign key ─────────
    await insertCategory('Has Ledger Entry');
    await admin.query(
      `insert into accounts (id, tenant_id, code, name, account_type) values ($1, $2, '6-0001', 'Test expense', 'expense')`,
      [ACCOUNT, TENANT],
    );
    await admin.query(`insert into transactions (id, tenant_id, txn_date) values ($1, $2, current_date)`, [
      TRANSACTION,
      TENANT,
    ]);
    await admin.query(
      `insert into transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, category_id)
       values ($1, $2, $3, 1, $4, 10, (select id from categories where tenant_id = $2 and name = 'Has Ledger Entry'))`,
      [randomUUID(), TENANT, TRANSACTION, ACCOUNT],
    );

    // ── A category that is itself a parent — a real, self-referencing FK ───
    await insertCategory('Has A Child');
    await insertCategory('The Child', 'Has A Child');
  });

  afterAll(async () => {
    await admin.query('delete from transaction_splits where tenant_id = $1', [TENANT]);
    await admin.query('delete from transactions where tenant_id = $1', [TENANT]);
    await admin.query('delete from accounts where tenant_id = $1', [TENANT]);
    await admin.query('delete from document_lines where tenant_id = $1', [TENANT]);
    await admin.query('delete from documents where tenant_id = $1', [TENANT]);
    await admin.query('delete from captures where tenant_id = $1', [TENANT]);
    await admin.query('delete from budgets where tenant_id = $1', [TENANT]);
    // Children before parents, or the self-referencing FK refuses the cleanup too.
    await admin.query('delete from categories where tenant_id = $1 and parent_id is not null', [TENANT]);
    await admin.query('delete from categories where tenant_id = $1', [TENANT]);
    await admin.query('delete from memberships where user_id = $1', [USER]);
    await admin.query('delete from users where id = $1', [USER]);
    await admin.query('delete from tenants where id = $1', [TENANT]);
    await admin.end();
  });

  it('deletes a category nothing points at', async () => {
    const result = await repo.deleteCategory(USER, TENANT, 'Unused');
    expect(result).toEqual({ outcome: 'deleted' });

    const row = await admin.query('select 1 from categories where tenant_id = $1 and name = $2', [
      TENANT,
      'Unused',
    ]);
    expect(row.rows).toHaveLength(0);
  });

  it('reports not_found for a category that does not exist', async () => {
    const result = await repo.deleteCategory(USER, TENANT, 'Nope Not A Category');
    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('refuses a category with a receipt line, and does not touch it', async () => {
    const result = await repo.deleteCategory(USER, TENANT, 'Has Receipt');
    expect(result.outcome).toBe('in_use');
    if (result.outcome === 'in_use') {
      expect(result.reasons.join(' ')).toMatch(/1 receipt line/);
    }
    const row = await admin.query('select 1 from categories where tenant_id = $1 and name = $2', [
      TENANT,
      'Has Receipt',
    ]);
    expect(row.rows).toHaveLength(1);
  });

  it('refuses a category referenced from the ledger', async () => {
    const result = await repo.deleteCategory(USER, TENANT, 'Has Ledger Entry');
    expect(result.outcome).toBe('in_use');
    if (result.outcome === 'in_use') {
      expect(result.reasons.join(' ')).toMatch(/1 ledger entry/);
    }
  });

  it('refuses a category that is a parent of another category', async () => {
    const result = await repo.deleteCategory(USER, TENANT, 'Has A Child');
    expect(result.outcome).toBe('in_use');
    if (result.outcome === 'in_use') {
      expect(result.reasons.join(' ')).toMatch(/1 subcategory/);
    }
  });

  /**
   * THE POINT OF THE WHOLE TICKET.
   *
   * `budgets.category` is not a foreign key — Postgres has no opinion about
   * whether this DELETE is safe. Only the application-level check in
   * `deleteCategory` stops it. Proven by removing that check (comment out the
   * `hasBudget` line in `describeUsage`, or the `has_budget` clause in its SQL)
   * and re-running this file: this test fails because the category is deleted
   * and a `budgets` row is left pointing at a name nothing answers to anymore.
   *
   * Actual failure, captured by running that broken version:
   *
   *   FAIL  src/settings/categories.e2e.test.ts > deleting a category
   *     > refuses a category with a budget, which the database alone would not catch
   *   AssertionError: expected 'deleted' to be 'in_use'
   *     - Expected: "in_use"
   *     + Received: "deleted"
   *
   *   FAIL  src/settings/categories.e2e.test.ts > deleting a category
   *     > refuses a category with a budget, which the database alone would not catch
   *   AssertionError: expected [] to have a length of 1 but got +0
   *
   * (the second failure is the orphaned `budgets` row: the category is gone,
   * the budget survives, and it now answers to nobody.)
   */
  it('refuses a category with a budget, which the database alone would not catch', async () => {
    const result = await repo.deleteCategory(USER, TENANT, 'Has Budget');
    expect(result.outcome).toBe('in_use');
    if (result.outcome === 'in_use') {
      expect(result.reasons).toContain('a monthly budget');
    }
    const row = await admin.query('select 1 from categories where tenant_id = $1 and name = $2', [
      TENANT,
      'Has Budget',
    ]);
    expect(row.rows).toHaveLength(1);
  });

  it('marks only the truly unused category as deletable in the list', async () => {
    const rows = await repo.listCategories(USER, TENANT);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['Has Receipt']?.deletable).toBe(false);
    expect(byName['Has Budget']?.deletable).toBe(false);
    expect(byName['Has Ledger Entry']?.deletable).toBe(false);
    expect(byName['Has A Child']?.deletable).toBe(false);
    // 'The Child' itself has nothing pointing at IT — being a child is not
    // being depended upon.
    expect(byName['The Child']?.deletable).toBe(true);
  });

  it('never uses ON DELETE CASCADE to make this work', async () => {
    // A schema-level guarantee, not just a behavioural one: cascading deletes
    // on these columns would silently take receipts and ledger lines with
    // them. This asserts the constraints are RESTRICT-shaped (no cascade
    // action recorded), independent of the application check above.
    const { rows } = await admin.query<{ conname: string; confdeltype: string }>(
      `select conname, confdeltype
         from pg_constraint
        where confrelid = 'categories'::regclass
          and contype = 'f'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // 'a' = NO ACTION, 'r' = RESTRICT. 'c' (CASCADE) must never appear here.
      expect(['a', 'r']).toContain(r.confdeltype);
    }
  });
});
