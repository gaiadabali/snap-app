import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { asUser, createDb, createPool, withTenantAs, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../db.js';
import type { ValidatedExtraction } from '../extraction/types.js';
import { saveExtraction } from '../repo.js';
import { startFakeYourtal, type FakeYourtal } from '../test-support/fake-yourtal.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { YourtalPartnerClient } from './client.js';
import { insertLink } from './links.repo.js';
import { drainYourtalOutbox, OUTBOX_RETRY } from './outbox.js';
import { YourtalLinkController } from './yourtal.controller.js';

/**
 * Ticket 2.5.b–d, end to end: a confirmed scan (`saveExtraction`, the exact
 * function the worker calls) queues a report in the outbox, and the drain —
 * on the WORKER's own database role — delivers it to a fake YourTal that
 * verifies every signature. Every outcome the ticket names is driven here.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b7a20000-0000-4000-8000-000000000001';
const WORKER = 'b7a20000-0000-4000-8000-0000000000a1';
const DANI = 'b7a20000-0000-4000-8000-0000000000a2';
const EVE = 'b7a20000-0000-4000-8000-0000000000a3';

const f = <T>(value: T | null, confidence = 0.99) => ({ value, confidence });
function reading(payable: string): ValidatedExtraction {
  return {
    extraction: {
      schemaVersion: '1',
      docType: f('receipt' as const),
      saysTaxInvoice: f(false),
      documentNumber: f(null),
      issueDate: f('2026-10-20'),
      currency: f('AUD'),
      supplierName: f('Outbox Test Cafe'),
      supplierAbn: f(null),
      buyerIdentified: f(false),
      taxExclusiveAmount: f(null),
      taxAmount: f(null),
      payableAmount: f(payable),
      lines: [{ description: f('Coffee'), quantity: f(1), unitPrice: f(payable), amount: f(payable), gstFree: f(false) }],
      notes: { legible: true, imageIssues: [], warnings: [] },
    },
    findings: [],
    complianceFailures: [],
    isTaxInvoice: false,
    belowTaxInvoiceThreshold: true,
    gstAtRisk: null,
    reviewStatus: 'auto_accepted',
    confidenceOverall: 0.99,
  };
}
const META = { model: 'gemma4:31b', promptVersion: 'test', latencyMs: 1, inputTokens: 1, outputTokens: 1, raw: '{}' };

const quiet = { log: () => {}, warn: () => {}, error: () => {} };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describeIfDb('the YourTal outbox (2.5)', () => {
  let admin: Client;
  let fake: FakeYourtal;
  let client: YourtalPartnerClient;
  let workerPool: Pool;
  let workerDb: Db;
  let counter = 0;

  /** A photographed one-page receipt uploaded by `uploader`; returns its page hash. */
  async function photographedCapture(uploader: string, receivedAt?: string): Promise<{ captureId: string; pageSha: string }> {
    counter += 1;
    const captureId = randomUUID();
    const pageSha = sha(`receipt photo ${counter} ${captureId}`);
    await withTenantAs(getDb(), uploader, TENANT, async (tx) => {
      await tx.execute(sql`
        insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                              original_byte_size, original_sha256, status, received_at)
        values (${captureId}, ${TENANT}, ${uploader}, ${`${TENANT}/pages/${pageSha.slice(0, 2)}/${pageSha}`},
                'image/jpeg', 2048, decode(${pageSha}, 'hex'), 'received', coalesce(${receivedAt ?? null}::timestamptz, now()))
      `);
      await tx.execute(sql`
        insert into capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
        values (${randomUUID()}, ${TENANT}, ${captureId}, 1, ${`${TENANT}/pages/${pageSha.slice(0, 2)}/${pageSha}`},
                'image/jpeg', 2048, decode(${pageSha}, 'hex'), 'capture')
      `);
    });
    return { captureId, pageSha };
  }

  // Every receipt gets its own amount unless a test says otherwise: the
  // same supplier, date and amount is how a re-photo is recognised, so a
  // shared default would make every scenario a "duplicate" of the first.
  let amounts = 0;
  const scan = (captureId: string, payable = `${(amounts += 1)}.25`) =>
    saveExtraction(WORKER, TENANT, captureId, reading(payable), META, null);

  async function outboxFor(captureId: string) {
    const rows = await admin.query(
      `select id, user_id, status, attempts, external_ref, idempotency_key, body, points, granted,
              last_http_status, last_code, next_attempt_at > now() as later
         from yourtal_outbox where capture_id = $1`,
      [captureId],
    );
    return rows.rows;
  }

  const drain = () => drainYourtalOutbox({ client, db: workerDb, workerId: 'test-drainer', log: quiet });

  beforeAll(async () => {
    process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'yourtal-outbox-'));
    fake = await startFakeYourtal();
    client = new YourtalPartnerClient({ baseUrl: fake.url, partnerId: fake.partnerId, secret: fake.secret, timeoutMs: 2000 });

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'YourTal outbox test co',
      users: [
        { id: WORKER, role: 'member', subject: 'test|yto-worker', email: 'worker@yourtal-outbox.test' },
        { id: DANI, role: 'owner', subject: 'test|yto-dani', email: 'dani@yourtal-outbox.test' },
        { id: EVE, role: 'member', subject: 'test|yto-eve', email: 'eve@yourtal-outbox.test' },
      ],
    });
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-link:%'`);

    // The worker's own role: the only one that reads the queue across users.
    const workerUrl =
      process.env.WORKER_DATABASE_URL ?? (process.env.DATABASE_URL ?? '').replace(/:\/\/[^:]+:/, '://snap_worker:');
    workerPool = createPool(workerUrl);
    workerDb = createDb(workerPool);

    // Dani links through the real endpoint, so the link row is exactly what
    // production writes. Back-date it a minute so "captured after linking"
    // is unambiguous for captures made below.
    const controller = new YourtalLinkController();
    controller.clientFor = () => client;
    const code = fake.issueCode({ id: 'yt-dani', region: 'AU' });
    await controller.link(
      { userId: DANI, email: 'dani@yourtal-outbox.test', displayName: 'Dani', initials: 'DA', emailVerified: true },
      { sessionId: 'test', tokenHash: Buffer.alloc(32) },
      { code },
    );
    await admin.query(`update yourtal_links set linked_at = now() - interval '1 minute' where user_id = $1`, [DANI]);
  });

  beforeEach(async () => {
    // Nothing from an earlier test may be due now and be drained by a later one.
    await admin.query(`update yourtal_outbox set status = 'failed', finished_at = now() where status = 'pending' and user_id = any($1)`, [[DANI, EVE]]);
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [WORKER, DANI, EVE]);
    await admin.end();
    await workerPool.end();
    await closeDb();
    await fake.close();
  });

  it('queues a confirmed scan once, named by the stored original\'s hash', async () => {
    const { captureId, pageSha } = await photographedCapture(DANI);
    await scan(captureId);
    await scan(captureId); // re-extraction: nothing new

    const rows = await outboxFor(captureId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ user_id: DANI, status: 'pending', attempts: 0, external_ref: `sha256:${pageSha}` });
    expect(JSON.parse(row.body)).toEqual({
      linkId: fake.linkFor('yt-dani')!.linkId,
      action: 'receipt_scanned',
      externalRef: `sha256:${pageSha}`,
      evidence: { captureId },
    });
  });

  it('delivers it: signed, the stored bytes, the stored key — and records the points', async () => {
    const { captureId } = await photographedCapture(DANI);
    await scan(captureId);
    const [queued] = await outboxFor(captureId);

    const before = fake.requests.length;
    const summary = await drain();
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });

    const sent = fake.requests.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      path: '/api/partners/actions',
      raw: queued.body,
      idempotencyKey: queued.idempotency_key,
      signatureValid: true,
    });
    expect((await outboxFor(captureId))[0]).toMatchObject({ status: 'sent', granted: true, points: 10, attempts: 1 });
  });

  it('does not queue for someone who is not linked, or a receipt from before the link', async () => {
    const eves = await photographedCapture(EVE);
    await scan(eves.captureId);
    expect(await outboxFor(eves.captureId)).toHaveLength(0);

    const old = await photographedCapture(DANI, new Date(Date.now() - 86_400_000).toISOString());
    await scan(old.captureId);
    expect(await outboxFor(old.captureId)).toHaveLength(0);
  });

  it('skips a re-photo of a receipt already reported, and says so in the status', async () => {
    const first = await photographedCapture(DANI);
    const rephoto = await photographedCapture(DANI);
    await scan(first.captureId, '17.40');
    await scan(rephoto.captureId, '17.40'); // same supplier, date and amount; different bytes

    expect((await outboxFor(first.captureId))[0]).toMatchObject({ status: 'pending' });
    const skipped = await admin.query(
      `select status, finished_at is not null as finished, last_code, duplicate_of_capture_id, external_ref
         from yourtal_outbox where capture_id = $1`,
      [rephoto.captureId],
    );
    expect(skipped.rows).toEqual([
      {
        status: 'skipped_duplicate',
        finished: true,
        last_code: 'likely_duplicate',
        duplicate_of_capture_id: first.captureId,
        external_ref: `sha256:${rephoto.pageSha}`,
      },
    ]);

    // Re-extracting the re-photo changes nothing; and only the first is sent.
    await scan(rephoto.captureId, '17.40');
    expect(await outboxFor(rephoto.captureId)).toHaveLength(1);
    const before = fake.requests.length;
    expect(await drain()).toMatchObject({ claimed: 1, sent: 1 });
    expect(JSON.parse(fake.requests.slice(before)[0]!.raw).evidence).toEqual({ captureId: first.captureId });

    const controller = new YourtalLinkController();
    controller.clientFor = () => client;
    const status = await controller.status({
      userId: DANI, email: 'dani@yourtal-outbox.test', displayName: 'Dani', initials: 'DA', emailVerified: true,
    });
    expect(status.receipts.skippedDuplicate).toBe(1);
  });

  it('still reports a genuinely different receipt from the same shop on the same day', async () => {
    const coffee = await photographedCapture(DANI);
    const lunch = await photographedCapture(DANI);
    await scan(coffee.captureId, '23.10');
    await scan(lunch.captureId, '23.90');
    expect((await outboxFor(coffee.captureId))[0]).toMatchObject({ status: 'pending' });
    expect((await outboxFor(lunch.captureId))[0]).toMatchObject({ status: 'pending' });
  });

  it('reports a re-photo when the earlier one never reached YourTal\'s ledger', async () => {
    const first = await photographedCapture(DANI);
    await scan(first.captureId, '31.00');
    // Its report died (cancelled, failed or dead): nothing was paid or refused.
    await admin.query(`update yourtal_outbox set status = 'failed', finished_at = now() where capture_id = $1`, [first.captureId]);
    const again = await photographedCapture(DANI);
    await scan(again.captureId, '31.00');
    expect((await outboxFor(again.captureId))[0]).toMatchObject({ status: 'pending' });
  });

  it('names a PDF by the stored PDF\'s bytes, read back from storage', async () => {
    const { put } = await import('../storage.js');
    const pdf = Buffer.from(`%PDF-1.7 outbox test ${randomUUID()}`);
    const stored = put(TENANT, pdf);
    const captureId = randomUUID();
    const renderSha = sha(`render of ${captureId}`);
    await withTenantAs(getDb(), DANI, TENANT, async (tx) => {
      await tx.execute(sql`
        insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                              original_byte_size, original_sha256, status)
        values (${captureId}, ${TENANT}, ${DANI}, ${stored.key}, 'application/pdf', ${pdf.byteLength},
                decode(${renderSha}, 'hex'), 'received')
      `);
      await tx.execute(sql`
        insert into capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256, source)
        values (${randomUUID()}, ${TENANT}, ${captureId}, 1, 'x', 'image/png', 10, decode(${renderSha}, 'hex'), 'pdf_render')
      `);
    });
    await scan(captureId);
    expect((await outboxFor(captureId))[0].external_ref).toBe(`sha256:${sha(pdf)}`);
  });

  it('retries a YourTal outage with the same key and bytes, and stops the batch', async () => {
    const a = await photographedCapture(DANI);
    const b = await photographedCapture(DANI);
    await scan(a.captureId);
    await scan(b.captureId);

    fake.inject({ status: 503, body: { code: 'persistence_unavailable', message: 'try again' } });
    const before = fake.requests.length;
    const first = await drain();
    expect(first).toMatchObject({ claimed: 2, retried: 1, released: 1 });
    expect(fake.requests.length - before).toBe(1); // the second was never sent

    const rows = [...(await outboxFor(a.captureId)), ...(await outboxFor(b.captureId))];
    const failed = rows.find((r) => r.attempts === 1)!;
    const untouched = rows.find((r) => r.attempts === 0)!;
    expect(failed).toMatchObject({ status: 'pending', later: true, last_http_status: 503, last_code: 'persistence_unavailable' });
    expect(untouched).toMatchObject({ status: 'pending', later: true });
    const firstTry = fake.requests.at(-1)!;

    await admin.query(`update yourtal_outbox set next_attempt_at = now() where id = any($1)`, [[failed.id, untouched.id]]);
    const second = await drain();
    expect(second).toMatchObject({ claimed: 2, sent: 2 });
    const retry = fake.requests.find((r, i) => i > before && r.idempotencyKey === firstTry.idempotencyKey && r !== firstTry)!;
    expect(retry.raw).toBe(firstTry.raw);
    expect(retry.signatureValid).toBe(true);
  });

  it('waits at least as long as a 429 asks', async () => {
    const { captureId } = await photographedCapture(DANI);
    await scan(captureId);
    fake.inject({ status: 429, body: { retryAfterSeconds: 900 } });
    await drain();
    const wait = await admin.query(
      `select extract(epoch from next_attempt_at - now()) as s from yourtal_outbox where capture_id = $1`,
      [captureId],
    );
    expect(Number(wait.rows[0].s)).toBeGreaterThan(850);
  });

  it('treats a duplicate as success, and a ledger refusal as final', async () => {
    const dup = await photographedCapture(DANI);
    await scan(dup.captureId);
    fake.paid.set(`sha256:${dup.pageSha}`, 'someone-else');
    await drain();
    expect((await outboxFor(dup.captureId))[0]).toMatchObject({ status: 'duplicate', granted: false, points: 0 });

    const capped = await photographedCapture(DANI);
    await scan(capped.captureId);
    fake.inject({ status: 409, body: { code: 'velocity_capped', message: 'daily limit' } });
    const summary = await drain();
    expect(summary).toMatchObject({ refused: 1 });
    expect((await outboxFor(capped.captureId))[0]).toMatchObject({ status: 'refused', last_code: 'velocity_capped' });
  });

  it('gives up after the last attempt and keeps the event as dead', async () => {
    const { captureId } = await photographedCapture(DANI);
    await scan(captureId);
    await admin.query(`update yourtal_outbox set attempts = $2 where capture_id = $1`, [captureId, OUTBOX_RETRY.maxAttempts - 1]);
    fake.inject({ status: 502, body: {} });
    expect(await drain()).toMatchObject({ dead: 1 });
    expect((await outboxFor(captureId))[0]).toMatchObject({ status: 'dead', attempts: OUTBOX_RETRY.maxAttempts });
  });

  it('keeps the application role from changing an event, and from seeing another person\'s', async () => {
    const { captureId } = await photographedCapture(DANI);
    await scan(captureId);
    const error = await asUser(getDb(), DANI, (tx) =>
      tx.execute(sql`update yourtal_outbox set status = 'sent', finished_at = now() where user_id = current_user_id()`),
    ).then(
      () => null,
      (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
    );
    expect(error).toMatch(/permission denied/);

    const seen = await asUser(getDb(), EVE, (tx) =>
      tx.execute<{ n: string }>(sql`select count(*)::text as n from yourtal_outbox`),
    );
    expect(seen.rows[0]!.n).toBe('0');

    // Nor can anyone queue against a link that is not theirs.
    const danisLink = await admin.query(`select id from yourtal_links where user_id = $1 and revoked_at is null`, [DANI]);
    // Nor write a finished outcome into its own outbox: only the drain may.
    const outcome = await asUser(getDb(), DANI, (tx) =>
      tx.execute(sql`
        insert into yourtal_outbox (user_id, link_row_id, external_ref, idempotency_key, body, status, finished_at, granted, points)
        values (current_user_id(), ${danisLink.rows[0].id}, 'sha256:self-paid', gen_random_uuid(), '{}', 'sent', now(), true, 999)
      `),
    ).then(
      () => null,
      (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
    );
    expect(outcome).toMatch(/row-level security/);

    const forged = await asUser(getDb(), EVE, (tx) =>
      tx.execute(sql`
        insert into yourtal_outbox (user_id, link_row_id, external_ref, idempotency_key, body)
        values (current_user_id(), ${danisLink.rows[0].id}, 'sha256:forged', gen_random_uuid(), '{}')
      `),
    ).then(
      () => null,
      (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
    );
    expect(forged).toMatch(/row-level security/);
  });

  it('marks the link broken on link_revoked, cancels what is queued under it, and the status says so', async () => {
    const a = await photographedCapture(DANI);
    const b = await photographedCapture(DANI);
    await scan(a.captureId);
    await scan(b.captureId);

    fake.revokeFromYourtal(fake.linkFor('yt-dani')!.linkId);
    const summary = await drain();
    expect(summary).toMatchObject({ claimed: 2, linkBroken: 1 });
    const statuses = [(await outboxFor(a.captureId))[0].status, (await outboxFor(b.captureId))[0].status].sort();
    expect(statuses).toEqual(['cancelled', 'link_broken']);

    const link = await admin.query(`select broken_reason from yourtal_links where user_id = $1 order by linked_at desc limit 1`, [DANI]);
    expect(link.rows[0].broken_reason).toBe('link_revoked');

    const controller = new YourtalLinkController();
    controller.clientFor = () => client;
    const status = await controller.status({
      userId: DANI, email: 'dani@yourtal-outbox.test', displayName: 'Dani', initials: 'DA', emailVerified: true,
    });
    expect(status).toMatchObject({ state: 'broken', brokenReason: 'link_revoked', region: 'AU' });
    expect(status.receipts.rewarded).toBeGreaterThanOrEqual(3);
    expect(status.pointsReported).toBe(status.receipts.rewarded * 10);

    // And nothing more is queued for Dani until she links again.
    const later = await photographedCapture(DANI);
    await scan(later.captureId);
    expect(await outboxFor(later.captureId)).toHaveLength(0);
  });

  it('marks the link broken on unknown_link too', async () => {
    const link = await insertLink(EVE, { linkId: randomUUID(), region: 'ID' });
    expect(link.ok).toBe(true);
    await admin.query(`update yourtal_links set linked_at = now() - interval '1 minute' where user_id = $1`, [EVE]);
    const { captureId } = await photographedCapture(EVE);
    await scan(captureId);
    await drain();
    expect((await outboxFor(captureId))[0]).toMatchObject({ status: 'link_broken', last_code: 'unknown_link' });
    const rows = await admin.query(`select broken_reason from yourtal_links where user_id = $1`, [EVE]);
    expect(rows.rows[0].broken_reason).toBe('unknown_link');
  });
});
