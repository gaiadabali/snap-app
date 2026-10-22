import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { asUser } from '@snap/db';
import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VerifiedEmailGuard, type AuthUser, type CurrentSessionInfo } from '../common/auth.guard.js';
import { closeDb, getDb } from '../db.js';
import { startFakeYourtal, type FakeYourtal } from '../test-support/fake-yourtal.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { YourtalPartnerClient } from './client.js';
import { YourtalLinkController } from './yourtal.controller.js';

/**
 * Ticket 2.4: linking, unlinking and the status endpoint, against a real
 * Postgres as the application role (so RLS is what is being tested) and a
 * fake YourTal that checks every signature.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'b7a10000-0000-4000-8000-000000000001';
const ANA = 'b7a10000-0000-4000-8000-0000000000a1';
const BEN = 'b7a10000-0000-4000-8000-0000000000a2';
const CAL = 'b7a10000-0000-4000-8000-0000000000a3';

const person = (userId: string, name: string): AuthUser => ({
  userId,
  email: `${name.toLowerCase()}@yourtal-link.test`,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  emailVerified: true,
});
const session = { sessionId: 'test', tokenHash: Buffer.alloc(32) } as CurrentSessionInfo;

async function refusal(promise: Promise<unknown>): Promise<{ status: number; error: string }> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof HttpException) {
      const body = e.getResponse() as { error: string };
      return { status: e.getStatus(), error: body.error };
    }
    throw e;
  }
  throw new Error('expected a refusal');
}

describeIfDb('the YourTal link endpoints (2.4)', () => {
  let admin: Client;
  let fake: FakeYourtal;
  let controller: YourtalLinkController;

  beforeAll(async () => {
    fake = await startFakeYourtal();
    process.env.YOURTAL_PARTNER_ID = fake.partnerId;
    process.env.YOURTAL_PARTNER_SECRET = fake.secret;
    process.env.YOURTAL_API_URL = fake.url;

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'YourTal link test co',
      users: [
        { id: ANA, role: 'owner', subject: 'test|yt-ana', email: 'ana@yourtal-link.test' },
        { id: BEN, role: 'member', subject: 'test|yt-ben', email: 'ben@yourtal-link.test' },
        { id: CAL, role: 'member', subject: 'test|yt-cal', email: 'cal@yourtal-link.test' },
      ],
    });
    await admin.query(`delete from rate_limits where bucket_key like 'yourtal-link:%'`);

    controller = new YourtalLinkController();
    controller.clientFor = () =>
      new YourtalPartnerClient({ baseUrl: fake.url, partnerId: fake.partnerId, secret: fake.secret, timeoutMs: 2000 });
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [ANA, BEN, CAL]);
    await admin.end();
    await closeDb();
    await fake.close();
    delete process.env.YOURTAL_PARTNER_ID;
    delete process.env.YOURTAL_PARTNER_SECRET;
    delete process.env.YOURTAL_API_URL;
  });

  it('starts unlinked, and says the feature is available', async () => {
    expect(await controller.status(person(ANA, 'Ana'))).toEqual({
      available: true,
      state: 'unlinked',
      region: null,
      linkedAt: null,
      brokenReason: null,
      receipts: { pending: 0, rewarded: 0, refused: 0, pausedRefused: 0, identityRefused: 0, skippedDuplicate: 0, skippedFree: 0 },
      pointsReported: 0,
      identityCheck: { required: false, missing: [] },
    });
  });

  it('needs a proven email to link, and the person\'s own session for both changes', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, YourtalLinkController.prototype.link) as unknown[];
    expect(guards).toContain(VerifiedEmailGuard);
    // @CurrentSession on both: under impersonation it throws 403 (auth.guard.ts).
    expect(YourtalLinkController.prototype.link.length).toBe(3);
    expect(YourtalLinkController.prototype.unlink.length).toBe(2);
  });

  it('refuses a malformed code without calling YourTal', async () => {
    const before = fake.requests.length;
    expect(await refusal(controller.link(person(ANA, 'Ana'), session, { code: '!!' }))).toEqual({
      status: 400,
      error: 'invalid_link_code',
    });
    expect(fake.requests.length).toBe(before);
  });

  it('passes on YourTal\'s refusal of an unknown code, and of a teen', async () => {
    expect(await refusal(controller.link(person(ANA, 'Ana'), session, { code: 'ZZZZ2345' }))).toEqual({
      status: 400,
      error: 'invalid_link_code',
    });
    const teen = fake.issueCode({ id: 'yt-teen', region: 'AU', teen: true });
    expect(await refusal(controller.link(person(CAL, 'Cal'), session, { code: teen }))).toEqual({
      status: 403,
      error: 'teen_consent_not_allowed',
    });
    expect((await controller.status(person(CAL, 'Cal'))).state).toBe('unlinked');
  });

  it('links with a good code, typed loosely', async () => {
    const code = fake.issueCode({ id: 'yt-ana', region: 'AU' });
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    const status = await controller.link(person(ANA, 'Ana'), session, { code: typed });
    expect(status).toMatchObject({ available: true, state: 'linked', region: 'AU', brokenReason: null });
    expect(status.linkedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const rows = await admin.query('select link_id, region from yourtal_links where user_id = $1', [ANA]);
    expect(rows.rows).toEqual([{ link_id: fake.linkFor('yt-ana')!.linkId, region: 'AU' }]);
  });

  it('refuses a second link while linked, before spending the code', async () => {
    const code = fake.issueCode({ id: 'yt-ana-2', region: 'AU' });
    const before = fake.requests.length;
    expect(await refusal(controller.link(person(ANA, 'Ana'), session, { code }))).toEqual({
      status: 409,
      error: 'already_linked',
    });
    expect(fake.requests.length).toBe(before);
  });

  it('keeps one person\'s link invisible to another (RLS)', async () => {
    expect((await controller.status(person(BEN, 'Ben'))).state).toBe('unlinked');
    const seen = await asUser(getDb(), BEN, (tx) =>
      tx.execute<{ n: string }>(sql`select count(*)::text as n from yourtal_links`),
    );
    expect(seen.rows[0]!.n).toBe('0');
    // And Ben cannot write a row in Ana's name.
    await expect(
      asUser(getDb(), BEN, (tx) =>
        tx.execute(sql`insert into yourtal_links (user_id, link_id, region) values (${ANA}, gen_random_uuid(), 'AU')`),
      ),
    ).rejects.toThrow();
  });

  it('refuses a YourTal account already linked to another Snap Apps account', async () => {
    // YourTal hands the same linkId back for the same YourTal user.
    const code = fake.issueCode({ id: 'yt-ana', region: 'AU' });
    expect(await refusal(controller.link(person(BEN, 'Ben'), session, { code }))).toEqual({
      status: 409,
      error: 'linked_to_another_account',
    });
    expect((await controller.status(person(BEN, 'Ben'))).state).toBe('unlinked');
  });

  it('keeps the link when YourTal cannot be told about an unlink', async () => {
    fake.inject(
      { status: 503, body: { code: 'persistence_unavailable' } },
      { status: 503, body: { code: 'persistence_unavailable' } },
      { status: 503, body: { code: 'persistence_unavailable' } },
    );
    expect(await refusal(controller.unlink(person(ANA, 'Ana'), session))).toEqual({
      status: 503,
      error: 'yourtal_unavailable',
    });
    expect((await controller.status(person(ANA, 'Ana'))).state).toBe('linked');
  });

  it('unlinks: YourTal first, then here', async () => {
    const status = await controller.unlink(person(ANA, 'Ana'), session);
    expect(status).toMatchObject({ state: 'unlinked', region: null });
    expect(fake.linkFor('yt-ana')!.revoked).toBe(true);
    const rows = await admin.query('select revoked_at from yourtal_links where user_id = $1', [ANA]);
    expect(rows.rows[0].revoked_at).not.toBeNull();

    const before = fake.requests.length;
    expect((await controller.unlink(person(ANA, 'Ana'), session)).state).toBe('unlinked');
    expect(fake.requests.length).toBe(before);
  });

  it('can link again after unlinking, with a new link id', async () => {
    const code = fake.issueCode({ id: 'yt-ana', region: 'AU' });
    expect((await controller.link(person(ANA, 'Ana'), session, { code })).state).toBe('linked');
    const rows = await admin.query('select distinct link_id from yourtal_links where user_id = $1', [ANA]);
    expect(rows.rows).toHaveLength(2);
  });

  it('loses a link race cleanly: 409, and the orphaned YourTal link is revoked', async () => {
    const code = fake.issueCode({ id: 'yt-cal', region: 'AU' });
    // Another request from Cal's account links a different YourTal account
    // while this one is waiting on YourTal.
    fake.onRequest = async (path) => {
      if (path !== '/api/partners/links') return;
      fake.onRequest = null;
      await admin.query(
        `insert into yourtal_links (user_id, link_id, region) values ($1, gen_random_uuid(), 'AU')`,
        [CAL],
      );
    };
    expect(await refusal(controller.link(person(CAL, 'Cal'), session, { code }))).toEqual({
      status: 409,
      error: 'already_linked',
    });
    expect(fake.linkFor('yt-cal')!.revoked).toBe(true);
  });

  it('never lets the application role delete link history', async () => {
    const error = await asUser(getDb(), ANA, (tx) =>
      tx.execute(sql`delete from yourtal_links where user_id = current_user_id()`),
    ).then(
      () => null,
      (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
    );
    expect(error).toMatch(/permission denied/);
  });

  it('says so when the partner link is not configured', async () => {
    const off = new YourtalLinkController();
    off.clientFor = () => null;
    expect(await refusal(off.link(person(CAL, 'Cal'), session, { code: 'ANYCODE2' }))).toEqual({
      status: 503,
      error: 'yourtal_not_configured',
    });
  });
});
