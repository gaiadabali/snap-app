import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ONBOARDING DOUBLE-COUNTED THE BUDGET — migration 0059.
 *
 * The repair removes the 'Everything else' row onboarding wrote ONLY when it is
 * provably that row (personal workspace, untouched since onboarding, exactly
 * equal to the sum of the other rows) and leaves every other shape alone. It is
 * idempotent.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const REPAIR = (() => {
  const file = readFileSync(new URL('../migrations/0059_onboarding_budget_double_count.sql', import.meta.url), 'utf8');
  return file.slice(file.indexOf('-- repair:start'), file.indexOf('-- repair:end'));
})();

describeIfDb('onboarding budget repair (migration 0059)', () => {
  let c: Client;
  const tenants: string[] = [];

  const tenant = async (kind: 'personal' | 'business' = 'personal') => {
    const id = randomUUID();
    tenants.push(id);
    await c.query(`INSERT INTO tenants (id, name, kind) VALUES ($1, 'obd', $2)`, [id, kind]);
    return id;
  };
  /** A budget row last written `afterMinutes` after the workspace was created. */
  const budget = async (t: string, category: string, monthly: string, afterMinutes = 0) =>
    c.query(
      `INSERT INTO budgets (tenant_id, category, monthly, updated_at)
       VALUES ($1, $2, $3, (SELECT created_at FROM tenants WHERE id = $1) + make_interval(mins => $4::int))`,
      [t, category, monthly, afterMinutes],
    );
  const rows = async (t: string) =>
    (await c.query('SELECT category, monthly::text FROM budgets WHERE tenant_id = $1 ORDER BY category', [t]))
      .rows as Array<{ category: string; monthly: string }>;

  beforeAll(async () => {
    c = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await c.connect();
  });

  afterAll(async () => {
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenants]);
    await c.end();
  });

  it('removes exactly the duplicated total and keeps the category rows (600 + 150 = 750)', async () => {
    const t = await tenant();
    await budget(t, 'Everything else', '750.0000');
    await budget(t, 'Groceries', '600.0000', 1);
    await budget(t, 'Household', '150.0000', 1);

    await c.query(REPAIR);

    const left = await rows(t);
    expect(left.map((r) => r.category)).toEqual(['Groceries', 'Household']);
    expect(left.reduce((a, r) => a + Number(r.monthly), 0)).toBe(750);
  });

  it('is idempotent', async () => {
    const t = await tenant();
    await budget(t, 'Everything else', '30.1000');
    await budget(t, 'Fuel', '10.0500');
    await budget(t, 'Fun', '20.0500');
    await c.query(REPAIR);
    await c.query(REPAIR);
    expect((await rows(t)).map((r) => r.category)).toEqual(['Fuel', 'Fun']);
  });

  it('leaves a lone total with no category rows (the web sign-up form) alone', async () => {
    const t = await tenant();
    await budget(t, 'Everything else', '2500.0000');
    await c.query(REPAIR);
    expect(await rows(t)).toEqual([{ category: 'Everything else', monthly: '2500.0000' }]);
  });

  it('leaves a row whose amount is not exactly the sum of the others', async () => {
    const t = await tenant();
    await budget(t, 'Everything else', '750.0000');
    await budget(t, 'Groceries', '600.0000', 1);
    await budget(t, 'Household', '150.0100', 1);
    await c.query(REPAIR);
    expect((await rows(t)).map((r) => r.category)).toEqual(['Everything else', 'Groceries', 'Household']);
  });

  it('leaves a row edited well after onboarding, even if it happens to equal the sum', async () => {
    const t = await tenant();
    await budget(t, 'Everything else', '750.0000', 60 * 24 * 3);
    await budget(t, 'Groceries', '600.0000', 1);
    await budget(t, 'Household', '150.0000', 1);
    await c.query(REPAIR);
    expect((await rows(t)).map((r) => r.category)).toEqual(['Everything else', 'Groceries', 'Household']);
  });

  it('leaves another workspace kind, and another category, alone', async () => {
    const biz = await tenant('business');
    await budget(biz, 'Everything else', '100.0000');
    await budget(biz, 'Fuel', '100.0000');
    const p = await tenant();
    await budget(p, 'Other', '100.0000');
    await budget(p, 'Fuel', '100.0000');
    await c.query(REPAIR);
    expect((await rows(biz)).length).toBe(2);
    expect((await rows(p)).length).toBe(2);
  });
});
