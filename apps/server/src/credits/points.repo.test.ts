import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import { getPointBalance, listPointLedger } from './points.repo.js';

/**
 * `points.repo.ts` — against a real Postgres, as the real application role.
 * The module is READ ONLY since the retirement of Snap Apps points
 * (`docs/ECOSYSTEM.md` D33), so the fixtures here are history rows inserted
 * with the owner connection, the way the old scan path wrote them.
 *
 * Points are USER-scoped (`docs/ECOSYSTEM.md` D27), so unlike every other
 * suite in this codebase these fixtures need no tenant at all — just a user.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const USER = 'de100000-0000-4000-8000-000000000001';
const OTHER_USER = 'de100000-0000-4000-8000-000000000002';

describeIfDb('points.repo', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL });
    await admin.connect();
    await admin.query('DELETE FROM point_ledger WHERE user_id = ANY($1::uuid[])', [[USER, OTHER_USER]]);
    await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER, OTHER_USER]]);
    await admin.query(
      `INSERT INTO users (id, subject, email, display_name)
       VALUES ($1,'test|points-user','points-user@points-repo.test','Points User'),
              ($2,'test|points-other','points-other@points-repo.test','Other User')`,
      [USER, OTHER_USER],
    );
  });

  afterAll(async () => {
    await admin.query('DELETE FROM point_ledger WHERE user_id = ANY($1::uuid[])', [[USER, OTHER_USER]]);
    await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER, OTHER_USER]]);
    await admin.end();
    await closeDb();
  });

  /** One history row, as the retired scan path wrote it. Owner connection: `app_rw` can only INSERT own rows. */
  async function historyRow(userId: string, ref: string, at = 'now()'): Promise<void> {
    await admin.query(
      `INSERT INTO point_ledger (id, user_id, delta, reason, ref, app, created_at)
       VALUES ($1, $2, 1, 'scan', $3, 'snap-apps', ${at})`,
      [randomUUID(), userId, ref],
    );
  }

  it('balance and ledger start empty', async () => {
    expect(await getPointBalance(USER)).toBe(0);
    expect(await listPointLedger(USER)).toEqual([]);
  });

  it('reads the retired history, and only the callers own', async () => {
    const captureId = randomUUID();
    await historyRow(USER, captureId);

    expect(await getPointBalance(USER)).toBe(1);
    const ledger = await listPointLedger(USER);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 1, reason: 'scan', ref: captureId, app: 'snap-apps' });

    // Never leaks into someone else's balance.
    expect(await getPointBalance(OTHER_USER)).toBe(0);
  });

  it('lists most-recent first and caps at the requested limit', async () => {
    const balanceBefore = await getPointBalance(OTHER_USER);
    const refs = Array.from({ length: 3 }, () => randomUUID());
    for (const [i, ref] of refs.entries()) {
      // eslint-disable-next-line no-await-in-loop -- created_at must differ.
      await historyRow(OTHER_USER, ref, `now() + interval '${i} seconds'`);
    }
    const ledger = await listPointLedger(OTHER_USER, 2);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.ref).toBe(refs[2]);
    expect(await getPointBalance(OTHER_USER)).toBe(balanceBefore + 3);
  });

  it('exports no writer: Snap Apps points are retired', async () => {
    const mod = await import('./points.repo.js');
    expect(Object.keys(mod).sort()).toEqual(['getPointBalance', 'listPointLedger']);
  });
});
