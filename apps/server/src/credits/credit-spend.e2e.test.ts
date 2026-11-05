import { randomBytes, randomUUID } from 'node:crypto';

import { createDb, createPool, NotTheWorkerError, withTenantAs, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';
import type { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import { createCapture, enqueueExtraction, resumeHeldCaptures } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { workerActor, type WorkerActor } from '../tenant-entry.js';
import { listCreditUsage, listCreditUsageMonths } from './credits.repo.js';
import { QuotaExhaustedError, refundScanCredit } from './spend.js';

/**
 * A scan spends one credit (group plan 7.1.a) and an unreadable scan gives it
 * back (7.1.c), against real Postgres, as the real roles: `enqueueExtraction`
 * on the API's `snap_app`, `refundScanCredit` on the worker's `snap_worker`.
 *
 * Grants and purchases are written through the admin connection with exact
 * `granted_at` values, so the spend order is asserted, not inferred.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'c5e40000-0000-4000-8000-000000000001';
const OTHER_TENANT = 'c5e40000-0000-4000-8000-000000000002';
const USER = 'c5e40000-0000-4000-8000-0000000000a1';
const WORKER = 'c5e40000-0000-4000-8000-0000000000a2';
const OTHER_USER = 'c5e40000-0000-4000-8000-0000000000a3';

describeIfDb('scan credits: spend, refuse, give back, list (7.1.a–e)', () => {
  let admin: Client;
  let adminOther: Client;
  let workerPool: Pool;
  let workerDb: Db;
  /** The worker on its own connection — the only way into `refundScanCredit`. */
  let worker: WorkerActor;

  async function capture(tenant = TENANT, uploader = USER): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/jpeg', 1024, decode($5, 'hex'), 'received')`,
      [id, tenant, uploader, `${tenant}/pages/${id}`, randomBytes(32).toString('hex')],
    );
    return id;
  }

  /** A grant `daysAgo` old; `bought` adds the paid purchase that makes it a bought credit. */
  async function grant(
    source: string,
    amount: number,
    daysAgo: number,
    o: { bought?: boolean; expired?: boolean; tenant?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    const tenant = o.tenant ?? TENANT;
    await admin.query(
      `insert into usage_grants (id, tenant_id, metric, amount, remaining, source, granted_at, expires_at)
       values ($1, $2, 'scans', $3, $3, $4, now() - make_interval(days => $5), $6::timestamptz)`,
      [id, tenant, amount, source, daysAgo, o.expired ? new Date(Date.now() - 3_600_000).toISOString() : null],
    );
    if (o.bought) {
      await admin.query(
        `insert into credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider, grant_id, paid_at)
         values ($1, $2, $3, 'credits_50', $4, 0.7, 'paid', 'manual', $5, now())`,
        [randomUUID(), tenant, USER, amount, id],
      );
    }
    return id;
  }

  async function spendOf(captureId: string) {
    const rows = await admin.query(
      `select grant_id, grant_source, paid, user_id, refunded_at, refund_reason from credit_spends where capture_id = $1`,
      [captureId],
    );
    return rows.rows;
  }

  async function jobsFor(captureId: string): Promise<number> {
    const rows = await admin.query(
      `select count(*)::int as n from jobs where kind = 'extract' and payload->>'captureId' = $1`,
      [captureId],
    );
    return rows.rows[0].n;
  }

  /** A capture with its one page stored, as the upload leaves it. */
  async function storedCapture(tenant = TENANT, uploader = USER): Promise<string> {
    const id = await capture(tenant, uploader);
    await admin.query(
      `insert into capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
       values ($1, $2, $3, 1, $4, 'image/jpeg', 1024, decode($5, 'hex'), 'capture')`,
      [randomUUID(), tenant, id, `${tenant}/pages/${id}-1`, randomBytes(32).toString('hex')],
    );
    return id;
  }

  async function remaining(grantId: string): Promise<number> {
    return (await admin.query(`select remaining from usage_grants where id = $1`, [grantId])).rows[0].remaining;
  }

  async function clearCredits(): Promise<void> {
    await admin.query(`delete from credit_spends where tenant_id = any($1)`, [[TENANT, OTHER_TENANT]]);
    await admin.query(`delete from credit_purchases where tenant_id = any($1)`, [[TENANT, OTHER_TENANT]]);
    await admin.query(`delete from usage_grants where tenant_id = any($1)`, [[TENANT, OTHER_TENANT]]);
    await admin.query(`delete from jobs where tenant_id = any($1)`, [[TENANT, OTHER_TENANT]]);
  }

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Credit spend co',
      users: [
        { id: USER, role: 'owner', subject: 'test|spend-user', email: 'user@credit-spend.test' },
      ],
      // No membership: the worker enters through `withWorkerTenant`.
      serviceUsers: [{ id: WORKER, subject: 'test|spend-worker', email: 'worker@credit-spend.test' }],
    });
    adminOther = await provisionTenant({
      tenantId: OTHER_TENANT,
      name: 'Credit spend other co',
      users: [{ id: OTHER_USER, role: 'owner', subject: 'test|spend-other', email: 'other@credit-spend.test' }],
    });
    const workerUrl =
      process.env.WORKER_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');
    workerPool = createPool(workerUrl);
    workerDb = createDb(workerPool);
    worker = workerActor(WORKER, workerDb);
  });

  beforeEach(clearCredits);

  afterAll(async () => {
    await clearCredits();
    await wipeTenant(adminOther, OTHER_TENANT, [OTHER_USER]);
    await wipeTenant(admin, TENANT, [USER, WORKER]);
    await adminOther.end();
    await admin.end();
    await workerPool.end();
    await closeDb();
  });

  it('spends the signup bonus first, then staff grants, then bought packs; oldest first within each', async () => {
    const pack = await grant('topup_pack', 2, 30, { bought: true }); // oldest of all, but bought
    const newerPack = await grant('topup_pack', 1, 1, { bought: true });
    const staffNew = await grant('platform_staff:00000000-0000-4000-8000-000000000009', 1, 2);
    const staffOld = await grant('platform_staff:00000000-0000-4000-8000-000000000008', 1, 5);
    const bonus = await grant('signup_bonus', 1, 0); // newest of all, but free and the bonus
    await grant('referral', 5, 10, { expired: true }); // expired: never used

    const expected = [
      [bonus, 'signup_bonus', false],
      [staffOld, 'platform_staff:00000000-0000-4000-8000-000000000008', false],
      [staffNew, 'platform_staff:00000000-0000-4000-8000-000000000009', false],
      [pack, 'topup_pack', true],
      [pack, 'topup_pack', true],
      [newerPack, 'topup_pack', true],
    ] as const;
    for (const [grantId, source, paid] of expected) {
      const captureId = await capture();
      await enqueueExtraction(USER, TENANT, captureId);
      expect(await spendOf(captureId)).toEqual([
        { grant_id: grantId, grant_source: source, paid, user_id: USER, refunded_at: null, refund_reason: null },
      ]);
    }
    for (const id of [pack, newerPack, staffNew, staffOld, bonus]) expect(await remaining(id)).toBe(0);

    // Out of credits (7.1.b): refused, nothing spent or queued, the capture kept.
    const held = await capture();
    await expect(enqueueExtraction(USER, TENANT, held)).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(await spendOf(held)).toEqual([]);
    expect(await jobsFor(held)).toBe(0);
    expect((await admin.query(`select status from captures where id = $1`, [held])).rows).toEqual([
      { status: 'received' },
    ]);
  });

  it('counts a grant as bought only when a paid purchase backs it', async () => {
    // A topup_pack grant with no purchase behind it (a hand-made support fix,
    // say) is not a bought credit, whatever its source says.
    const orphan = await grant('topup_pack', 1, 3);
    const captureId = await capture();
    await enqueueExtraction(USER, TENANT, captureId);
    expect(await spendOf(captureId)).toMatchObject([{ grant_id: orphan, grant_source: 'topup_pack', paid: false }]);
  });

  it('never spends twice for one capture, called again or called at once', async () => {
    const pack = await grant('topup_pack', 10, 1, { bought: true });

    const again = await capture();
    await enqueueExtraction(USER, TENANT, again);
    await enqueueExtraction(USER, TENANT, again);
    expect(await spendOf(again)).toHaveLength(1);
    expect(await jobsFor(again)).toBe(1);
    expect(await remaining(pack)).toBe(9);

    const atOnce = await capture();
    await Promise.all([1, 2, 3, 4].map(() => enqueueExtraction(USER, TENANT, atOnce)));
    expect(await spendOf(atOnce)).toHaveLength(1);
    expect(await jobsFor(atOnce)).toBe(1);
    expect(await remaining(pack)).toBe(8);
  });

  it('under parallel captures, takes exactly as many credits as there are, never below zero', async () => {
    const a = await grant('signup_bonus', 3, 2);
    const b = await grant('topup_pack', 2, 1, { bought: true });
    const n = 12;
    const captures: string[] = [];
    for (let i = 0; i < n; i += 1) captures.push(await capture());

    const results = await Promise.allSettled(captures.map((id) => enqueueExtraction(USER, TENANT, id)));

    const spends = (
      await admin.query(
        `select grant_id, paid from credit_spends where capture_id = any($1)`,
        [captures],
      )
    ).rows as Array<{ grant_id: string | null; paid: boolean }>;
    expect(spends).toHaveLength(5);
    expect(spends.filter((s) => s.grant_id === a)).toHaveLength(3);
    expect(spends.filter((s) => s.grant_id === b)).toHaveLength(2);
    expect(spends.filter((s) => s.paid)).toHaveLength(2);
    expect(await remaining(a)).toBe(0);
    expect(await remaining(b)).toBe(0);
    // The other seven were refused for want of credit (7.1.b) and not queued.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(n - 5);
    for (const r of refused) expect(r.reason).toBeInstanceOf(QuotaExhaustedError);
    const jobs = await admin.query(`select count(*)::int as n from jobs where tenant_id = $1 and kind = 'extract'`, [TENANT]);
    expect(jobs.rows[0].n).toBe(5);
  });

  it('races for the last credit: one capture gets it, the rest are held, never dropped, and resume when credits come', async () => {
    const last = await grant('signup_bonus', 1, 1);
    const racers: string[] = [];
    for (let i = 0; i < 6; i += 1) racers.push(await storedCapture());

    const results = await Promise.allSettled(racers.map((id) => enqueueExtraction(USER, TENANT, id)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(QuotaExhaustedError);
    }
    expect(await remaining(last)).toBe(0);
    const spent = (await admin.query(`select capture_id from credit_spends where capture_id = any($1)`, [racers]))
      .rows as Array<{ capture_id: string }>;
    expect(spent).toHaveLength(1);
    expect(spent[0]!.capture_id).toBe(racers[results.findIndex((r) => r.status === 'fulfilled')]);

    // Every capture is still there, pages and all.
    const kept = await admin.query(
      `select count(*)::int as n from captures c
        where c.id = any($1) and exists (select 1 from capture_pages p where p.capture_id = c.id)`,
      [racers],
    );
    expect(kept.rows[0].n).toBe(6);

    // Nothing to resume with no credit; three bought credits queue the oldest three held.
    expect(await resumeHeldCaptures(USER, TENANT)).toBe(0);
    await grant('topup_pack', 3, 0, { bought: true });
    expect(await resumeHeldCaptures(USER, TENANT)).toBe(3);
    expect(await resumeHeldCaptures(USER, TENANT)).toBe(0);
    const queued = await admin.query(
      `select count(*)::int as n from jobs where kind = 'extract' and payload->>'captureId' = any($1)`,
      [racers],
    );
    expect(queued.rows[0].n).toBe(4);
  });

  it('refuses a NEW capture at registration with no credit, storing nothing, but never a duplicate', async () => {
    const page = { sha256: randomBytes(32).toString('hex'), mimeType: 'image/jpeg', byteSize: 1000 };
    await expect(createCapture(USER, TENANT, { pages: [page], requireCredit: true })).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    );
    const none = await admin.query(`select count(*)::int as n from captures where tenant_id = $1 and received_at > now() - interval '1 minute' and original_byte_size = 1000`, [TENANT]);
    expect(none.rows[0].n).toBe(0);

    // With a credit it is admitted (registration spends nothing) ...
    const bonus = await grant('signup_bonus', 1, 0);
    const first = await createCapture(USER, TENANT, { pages: [page], requireCredit: true });
    expect(first.duplicate).toBe(false);
    expect(await remaining(bonus)).toBe(1);
    // ... and, once the credits are gone, the same bytes are still a duplicate, not a refusal.
    await admin.query(`update usage_grants set remaining = 0 where id = $1`, [bonus]);
    const again = await createCapture(USER, TENANT, { pages: [page], requireCredit: true });
    expect(again).toMatchObject({ duplicate: true, capture: { id: first.capture.id } });
  });

  it('lists a month of spends, newest first, refunds at 0, paged with before (7.1.e)', async () => {
    const pack = await grant('topup_pack', 5, 1, { bought: true });
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await capture();
      await enqueueExtraction(USER, TENANT, id);
      ids.push(id);
    }
    await refundScanCredit(worker, TENANT, ids[1]!, 'unreadable');
    // An old spend in another month, and a historical one that found no credit.
    await admin.query(
      `insert into credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid, spent_at)
       values ($1, $2, $3, null, null, false, '2026-01-15T10:00:00Z')`,
      [TENANT, await capture(), USER],
    );
    expect(await remaining(pack)).toBe(3);

    const month = new Date().toISOString().slice(0, 7);
    const page1 = await listCreditUsage(USER, TENANT, month, 2, null);
    expect(page1.total).toBe(2);
    expect(page1.items.map((i) => i.amount)).toEqual([1, 0]);
    expect(page1.items[1]).toMatchObject({ refunded: true, label: 'Scan' });
    expect(page1.nextBefore).toBe(page1.items[1]!.id);
    const page2 = await listCreditUsage(USER, TENANT, month, 2, page1.nextBefore);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]).toMatchObject({ amount: 1, refunded: false });
    expect(page2.nextBefore).toBeNull();

    const january = await listCreditUsage(USER, TENANT, '2026-01', 100, null);
    expect(january).toMatchObject({ total: 0, items: [{ amount: 0, refunded: false }] });
    expect(await listCreditUsageMonths(USER, TENANT)).toEqual([month, '2026-01']);
    // Another workspace sees none of it.
    expect(await listCreditUsageMonths(OTHER_USER, OTHER_TENANT)).toEqual([]);
  });

  it('gives an unreadable scan its credit back, exactly once', async () => {
    const pack = await grant('topup_pack', 2, 1, { bought: true });
    const captureId = await capture();
    await enqueueExtraction(USER, TENANT, captureId);
    expect(await remaining(pack)).toBe(1);

    const results = await Promise.all([
      refundScanCredit(worker, TENANT, captureId, 'unreadable'),
      refundScanCredit(worker, TENANT, captureId, 'unreadable'),
    ]);
    expect(results.filter((r) => r.refunded)).toEqual([{ refunded: true, creditReturned: true }]);
    expect(await refundScanCredit(worker, TENANT, captureId, 'not_extracted')).toEqual({
      refunded: false,
      why: 'no_spend_or_already_refunded',
    });
    expect(await remaining(pack)).toBe(2);
    expect(await spendOf(captureId)).toMatchObject([{ grant_id: pack, paid: true, refund_reason: 'unreadable' }]);
    expect((await spendOf(captureId))[0].refunded_at).not.toBeNull();
  });

  it('never refunds a capture that produced a document', async () => {
    const pack = await grant('topup_pack', 2, 1, { bought: true });
    const captureId = await capture();
    await enqueueExtraction(USER, TENANT, captureId);
    await admin.query(
      `insert into documents (id, tenant_id, capture_id, is_tax_invoice, review_status, currency)
       values ($1, $2, $3, false, 'auto_accepted', 'AUD')`,
      [randomUUID(), TENANT, captureId],
    );

    expect(await refundScanCredit(worker, TENANT, captureId, 'unreadable')).toEqual({
      refunded: false,
      why: 'has_document',
    });
    expect(await remaining(pack)).toBe(1);
    expect(await spendOf(captureId)).toMatchObject([{ refunded_at: null }]);
  });

  it('marks a spend with no credit as refunded without inventing one', async () => {
    // Only from before 7.1.b: a scan that found no credit was still queued.
    const captureId = await capture();
    await admin.query(
      `insert into credit_spends (tenant_id, capture_id, user_id, grant_id, grant_source, paid)
       values ($1, $2, $3, null, null, false)`,
      [TENANT, captureId, USER],
    );
    expect(await refundScanCredit(worker, TENANT, captureId, 'unreadable')).toEqual({
      refunded: true,
      creditReturned: false,
    });
  });

  it('lets only the worker give a credit back, and keeps each workspace to its own spends', async () => {
    await grant('topup_pack', 2, 1, { bought: true });
    const captureId = await capture();
    await enqueueExtraction(USER, TENANT, captureId);

    // The API's connection cannot even enter as the worker: `withWorkerTenant`
    // checks the connection's role, and `snap_app` is not `app_worker`.
    await expect(refundScanCredit(workerActor(WORKER), TENANT, captureId, 'unreadable')).rejects.toBeInstanceOf(
      NotTheWorkerError,
    );

    // And a member on the API's role may not refund either: migration 0039
    // grants app_rw SELECT and INSERT on credit_spends, never UPDATE.
    const denied = await withTenantAs(getDb(), USER, TENANT, (tx) =>
      tx.execute(sql`update credit_spends set refunded_at = now(), refund_reason = 'unreadable' where capture_id = ${captureId}`),
    ).then(
      () => null,
      (e: { cause?: { message?: string }; message?: string }) => e.cause?.message ?? e.message ?? String(e),
    );
    expect(denied).toMatch(/permission denied/);

    // Another workspace's worker context sees no capture and no spend.
    expect(await refundScanCredit(worker, OTHER_TENANT, captureId, 'unreadable')).toEqual({
      refunded: false,
      why: 'no_capture',
    });
    expect(await spendOf(captureId)).toMatchObject([{ refunded_at: null }]);

    // Spends in another workspace do not use this workspace's credits.
    const theirs = await grant('signup_bonus', 1, 0, { tenant: OTHER_TENANT });
    const theirCapture = await capture(OTHER_TENANT, OTHER_USER);
    await enqueueExtraction(OTHER_USER, OTHER_TENANT, theirCapture);
    expect(await spendOf(theirCapture)).toMatchObject([{ grant_id: theirs, grant_source: 'signup_bonus' }]);
  });
});
