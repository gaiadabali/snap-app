import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import { awardScanPoint, getPointBalance, listPointLedger } from './points.repo.js';

/**
 * `points.repo.ts` — against a real Postgres, as the real application role.
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

  it('balance and ledger start empty', async () => {
    expect(await getPointBalance(USER)).toBe(0);
    expect(await listPointLedger(USER)).toEqual([]);
  });

  it('awards one point for a completed scan, attributed to the capturing user', async () => {
    const captureId = randomUUID();
    const result = await awardScanPoint(USER, captureId);
    expect(result).toEqual({ awarded: true });

    expect(await getPointBalance(USER)).toBe(1);
    const ledger = await listPointLedger(USER);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 1, reason: 'scan', ref: captureId, app: 'snap-apps' });

    // Never leaks into someone else's balance.
    expect(await getPointBalance(OTHER_USER)).toBe(0);
  });

  it('refuses a second point for the SAME scan — a retried or re-run capture does not pay twice', async () => {
    const captureId = randomUUID();
    const first = await awardScanPoint(USER, captureId);
    expect(first).toEqual({ awarded: true });

    // Re-extraction of the same capture calls this again with the same ref.
    const second = await awardScanPoint(USER, captureId);
    expect(second).toEqual({ awarded: false });

    const ledger = await listPointLedger(USER);
    expect(ledger.filter((r) => r.ref === captureId)).toHaveLength(1);
  });

  it('a different capture for the same user earns a separate point', async () => {
    const before = await getPointBalance(USER);
    await awardScanPoint(USER, randomUUID());
    expect(await getPointBalance(USER)).toBe(before + 1);
  });

  it('handles many concurrent awards for the SAME scan as exactly one point', async () => {
    // The shape of a retried capture racing itself: several calls land at
    // once, and the unique index — not a check-then-insert — is what keeps
    // this at one point rather than N.
    const captureId = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => awardScanPoint(USER, captureId)));
    expect(results.filter((r) => r.awarded)).toHaveLength(1);

    const ledger = await listPointLedger(USER);
    expect(ledger.filter((r) => r.ref === captureId)).toHaveLength(1);
  });

  it('lists most-recent first and caps at the requested limit', async () => {
    const balanceBefore = await getPointBalance(OTHER_USER);
    const refs = Array.from({ length: 3 }, () => randomUUID());
    for (const ref of refs) {
      // eslint-disable-next-line no-await-in-loop -- ordering matters: created_at must differ.
      await awardScanPoint(OTHER_USER, ref);
    }
    const ledger = await listPointLedger(OTHER_USER, 2);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]!.ref).toBe(refs[2]);
    expect(await getPointBalance(OTHER_USER)).toBe(balanceBefore + 3);
  });
});
