import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { PERSONAL_DEDUCTION_CATEGORIES } from './deduction-categories.js';

/** The 0042 backfill and PERSONAL_DEDUCTION_CATEGORIES must stay the same list. */
const sqlText = readFileSync(
  fileURLToPath(new URL('../../../../packages/db/migrations/0042_deduction_categories.sql', import.meta.url)),
  'utf8',
);
const backfill = /-- backfill:start\n([\s\S]*?)-- backfill:end/.exec(sqlText)![1]!;
const rows = [...backfill.matchAll(/^\s*\('([^']*)', '([^']*)', '([^']*)', (true|false)\),?$/gm)].map((m) => ({
  name: m[1]!,
  label: m[2]!,
  item: m[3]!,
  active: m[4] === 'true',
}));
const expected = PERSONAL_DEDUCTION_CATEGORIES.map((s) => ({
  name: s.name,
  label: s.label,
  item: s.itemId,
  active: s.active,
}));

describe('0042 backfill vs PERSONAL_DEDUCTION_CATEGORIES', () => {
  it('lists the same categories, in the same order', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toEqual(expected);
  });
});

const T = 'd0d0d0d0-0000-4000-8000-0000000000d1';
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('0042 backfill, run against a personal workspace', () => {
  it('adds exactly the seeded rows, and running it twice adds nothing', async () => {
    const admin: Client = await provisionTenant({ tenantId: T, name: 'Backfill household', users: [] });
    try {
      await admin.query(`update tenants set kind = 'personal', abn = null, gst_registered = false where id = $1`, [T]);
      await admin.query('delete from categories where tenant_id = $1', [T]);
      const read = async () =>
        (
          await admin.query(
            `select name, ato_deduction_code as label, engine_row_id as item, active
               from categories where tenant_id = $1`,
            [T],
          )
        ).rows;
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

      await admin.query(backfill);
      const first = await read();
      expect([...first].sort(byName)).toEqual([...expected].sort(byName));

      await admin.query(backfill);
      expect(await read()).toHaveLength(first.length);
    } finally {
      await wipeTenant(admin, T);
      await admin.end();
    }
  });
});
