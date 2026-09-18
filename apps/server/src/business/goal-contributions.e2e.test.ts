import type { Client } from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { withTenant, withTenantAs } from '@snap/db';

import { closeDb, getDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import * as repo from './business.repo.js';

/**
 * Migration 0030: a savings goal's balance stops being a bare running total.
 *
 * `goals.saved` used to be `update goals set saved = saved + $1` — a number
 * with nothing behind it. Every assertion below is either "the record exists
 * and explains the number" or "the number cannot drift from the record",
 * against real Postgres, as `snap_app` (via `withTenantAs`/`withTenant`) for
 * everything the application itself does — RLS on `goal_contributions` is
 * half of what a real write path has to survive. The one deliberate exception
 * is the drift-guarantee tests, which use the privileged admin connection ON
 * PURPOSE: the claim under test is that `goals.saved` cannot drift no matter
 * WHO writes to it, not merely that the application is disciplined about it.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

// A prefix not shared with any other suite's fixed test ids — reusing one
// (this collided with capture-document.e2e.test.ts's ids on the first pass)
// leaves a shared dev database with cross-suite foreign key references that
// look like a schema bug and are actually just an id clash.
const TENANT = 'ac00ac00-0000-4000-8000-000000000001';
const OWNER = 'ac00ac00-0000-4000-8000-0000000000a1';
const OTHER_TENANT = 'ac00ac00-0000-4000-8000-000000000002';
const OUTSIDER = 'ac00ac00-0000-4000-8000-0000000000a2';

describeIfDb('goal contributions (0030)', () => {
  let admin: Client;
  let goalId: string;

  beforeAll(async () => {
    // Only business.repo.ts is under test here, but getDb()/config() validate
    // the whole env schema up front (see config.ts), and this suite may run
    // before any file that would otherwise have set this already.
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Goal contributions test co',
      users: [
        {
          id: OWNER,
          role: 'owner',
          subject: 'test|goal-owner',
          email: 'owner@goal-contrib.test',
          displayName: 'Goal Owner',
        },
      ],
    });

    // A second, unrelated tenant purely for the cross-tenant refusal tests.
    await admin.query(
      `insert into tenants (id, name, kind) values ($1, $2, 'personal') on conflict (id) do nothing`,
      [OTHER_TENANT, 'Other tenant co'],
    );
    await admin.query(
      `insert into users (id, subject, email, display_name) values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [OUTSIDER, 'test|goal-outsider', 'outsider@goal-contrib.test', 'Outsider'],
    );
    await admin.query(
      `insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing`,
      [OTHER_TENANT, OUTSIDER],
    );
  });

  afterAll(async () => {
    await admin.query('delete from memberships where user_id = $1', [OUTSIDER]);
    await admin.query('delete from users where id = $1', [OUTSIDER]);
    await admin.query('delete from tenants where id = $1', [OTHER_TENANT]);
    await wipeTenant(admin, TENANT, [OWNER]);
    await admin.end();
    await closeDb();
  });

  // A fresh goal per test: `saved` accumulates across contributions, and
  // sharing one goal across tests would make each assertion depend on
  // execution order.
  beforeEach(async () => {
    const goal = await repo.createGoal(OWNER, TENANT, 'Test goal', '1000.0000', null);
    goalId = goal.id;
  });

  it('starts a new goal at zero, with no contribution behind it', async () => {
    const mine = (await repo.listGoals(OWNER, TENANT)).find((g) => g.id === goalId)!;
    expect(mine.saved).toBe('0.0000');
    expect(await repo.listGoalContributions(OWNER, TENANT, goalId)).toEqual([]);
  });

  it('records a manual contribution and derives goals.saved from it', async () => {
    const created = await repo.addGoalContribution(OWNER, TENANT, goalId, '100.0000', '2026-08-01');
    expect(created.source).toBe('manual');
    expect(created.amount).toBe('100.0000');
    expect(created.occurred_on).toBe('2026-08-01');
    expect(created.created_by_name).toBe('Goal Owner');

    await repo.addGoalContribution(OWNER, TENANT, goalId, '50.5000', '2026-08-15');

    const mine = (await repo.listGoals(OWNER, TENANT)).find((g) => g.id === goalId)!;
    expect(mine.saved).toBe('150.5000');

    const rows = await repo.listGoalContributions(OWNER, TENANT, goalId);
    expect(rows).toHaveLength(2);
    // Newest movement first.
    expect(rows[0]!.occurred_on).toBe('2026-08-15');
    expect(rows[1]!.occurred_on).toBe('2026-08-01');
    expect(rows.every((r) => r.source === 'manual')).toBe(true);
  });

  it('defaults occurredOn to today when the caller does not send one', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await repo.addGoalContribution(OWNER, TENANT, goalId, '10.0000', null);
    expect(created.occurred_on).toBe(today);
  });

  it('removing a contribution adjusts the total — the point of having a record at all', async () => {
    const a = await repo.addGoalContribution(OWNER, TENANT, goalId, '100.0000', null);
    await repo.addGoalContribution(OWNER, TENANT, goalId, '25.0000', null);

    let mine = (await repo.listGoals(OWNER, TENANT)).find((g) => g.id === goalId)!;
    expect(mine.saved).toBe('125.0000');

    await repo.removeGoalContribution(OWNER, TENANT, goalId, a.id);

    mine = (await repo.listGoals(OWNER, TENANT)).find((g) => g.id === goalId)!;
    expect(mine.saved).toBe('25.0000');
    expect((await repo.listGoalContributions(OWNER, TENANT, goalId)).map((r) => r.id)).not.toContain(
      a.id,
    );
  });

  it('refuses a contribution of zero or less — the database check, not just the app', async () => {
    await expect(repo.addGoalContribution(OWNER, TENANT, goalId, '0.0000', null)).rejects.toThrow();
    await expect(repo.addGoalContribution(OWNER, TENANT, goalId, '-5.0000', null)).rejects.toThrow();
    const mine = (await repo.listGoals(OWNER, TENANT)).find((g) => g.id === goalId)!;
    expect(mine.saved).toBe('0.0000');
  });

  it('refuses to list, add to, or remove from a goal in a tenant the caller is not a member of', async () => {
    // OUTSIDER belongs only to OTHER_TENANT. Asking with TENANT is the
    // isolation case, exactly like every other repo in this codebase.
    await expect(repo.listGoalContributions(OUTSIDER, TENANT, goalId)).rejects.toThrow();
    await expect(
      repo.addGoalContribution(OUTSIDER, TENANT, goalId, '10.0000', null),
    ).rejects.toThrow();
    await expect(repo.removeGoalContribution(OUTSIDER, TENANT, goalId, goalId)).rejects.toThrow();

    // Nothing leaked through despite the attempts.
    const mine = (await repo.listGoals(OWNER, TENANT)).find((g) => g.id === goalId)!;
    expect(mine.saved).toBe('0.0000');
  });

  it('RLS itself (not just the membership gate) hides another tenant\'s contributions', async () => {
    await repo.addGoalContribution(OWNER, TENANT, goalId, '77.0000', null);

    // `withTenant` sets a valid tenant context with NO membership check —
    // OTHER_TENANT is a real tenant, just not the one `goalId` belongs to.
    // If RLS were not enforcing tenant_id on `goal_contributions`, this would
    // see the row anyway.
    const seen = await withTenant(getDb(), OTHER_TENANT, (tx) =>
      tx.execute(sql`select 1 as ok from goal_contributions where goal_id = ${goalId}`),
    );
    expect(seen.rows).toEqual([]);

    // And a delete issued from that same wrong tenant context matches nothing.
    await withTenant(getDb(), OTHER_TENANT, (tx) =>
      tx.execute(sql`delete from goal_contributions where goal_id = ${goalId}`),
    );
    const stillThere = await withTenantAs(getDb(), OWNER, TENANT, (tx) =>
      tx.execute(sql`select amount::text from goal_contributions where goal_id = ${goalId}`),
    );
    expect(stillThere.rows).toEqual([{ amount: '77.0000' }]);
  });

  it('goals.saved cannot drift — a direct write to it is overwritten by the true sum', async () => {
    await repo.addGoalContribution(OWNER, TENANT, goalId, '42.0000', null);

    // The privileged connection ON PURPOSE: the claim is that NOTHING can
    // make this column disagree with its own contributions, not merely that
    // business.repo.ts behaves. `saved` is not even sent by application code
    // anymore (see business.repo.ts), so this simulates the worst case —
    // a stray migration, an admin console, anything — writing it directly.
    await admin.query(`update goals set saved = '999999.0000' where id = $1`, [goalId]);

    const row = (await admin.query('select saved from goals where id = $1', [goalId])).rows[0];
    expect(row.saved).toBe('42.0000');
  });

  it(
    'the drift guarantee is real — verified by breaking it, then restored',
    async () => {
      await repo.addGoalContribution(OWNER, TENANT, goalId, '42.0000', null);

      // Disable the guard and repeat the exact same rogue write. If this
      // still came back as 42.0000, the previous test would be proving
      // nothing — the assertion has to be capable of failing.
      await admin.query('alter table goals disable trigger trg_goals_saved_authoritative');
      try {
        await admin.query(`update goals set saved = '999999.0000' where id = $1`, [goalId]);
        const broken = (await admin.query('select saved from goals where id = $1', [goalId])).rows[0];
        expect(broken.saved).toBe('999999.0000'); // the guard is OFF: drift happens.
      } finally {
        // Restore: re-enable the trigger, then touch the row so it recomputes.
        await admin.query('alter table goals enable trigger trg_goals_saved_authoritative');
        await admin.query('update goals set updated_at = now() where id = $1', [goalId]);
      }

      const restored = (await admin.query('select saved from goals where id = $1', [goalId])).rows[0];
      expect(restored.saved).toBe('42.0000');
    },
  );
});
