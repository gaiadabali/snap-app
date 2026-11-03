import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { withTenantAs } from '@snap/db';
import { resolveCategoryEdit } from './category-edit.js';

/**
 * The live bug: an installed phone's EditFields always sends `header.category`
 * (the category NAME) with any save, so a save of an unrelated field must not
 * 400 or re-file the receipt. Real Postgres, as the application role.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

const TENANT = 'd0d0d0d0-0000-4000-8000-0000000000c1';
const KATE = 'd0d0d0d0-0000-4000-8000-0000000000c2';
const TRAVEL = randomUUID();

describeIfDb('resolveCategoryEdit: header.category by name (installed phones)', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Category edit test co',
      users: [{ id: KATE, role: 'owner', subject: 'test|catedit-kate', email: 'kate@catedit.test', displayName: 'Kate' }],
    });
    await withTenantAs(getDb(), KATE, TENANT, (tx) =>
      tx.execute(sql`insert into categories (id, tenant_id, name) values (${TRAVEL}, ${TENANT}, 'Travel')`),
    );
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [KATE]);
    await admin.end();
    await closeDb();
  });

  const run = (name: string | null, current: { category_id: string | null; category_name: string | null }) =>
    resolveCategoryEdit(KATE, TENANT, { 'header.category': name }, current);

  it('the same name as the current category is a no-op (any capitalisation)', async () => {
    const current = { category_id: TRAVEL, category_name: 'Travel' };
    expect(await run('Travel', current)).toBeNull();
    expect(await run(' travel ', current)).toBeNull();
  });

  it('"Uncategorised" on an uncategorised receipt is a no-op', async () => {
    expect(await run('Uncategorised', { category_id: null, category_name: null })).toBeNull();
  });

  it('the name of a workspace category files the receipt in it', async () => {
    expect(await run('Travel', { category_id: null, category_name: null })).toEqual({ categoryId: TRAVEL });
  });

  it('an unknown name is a no-op, so the other edits still save', async () => {
    expect(await run('No Such Category', { category_id: null, category_name: null })).toBeNull();
    expect(await run('Tolls', { category_id: TRAVEL, category_name: 'Travel' })).toBeNull();
  });
});
