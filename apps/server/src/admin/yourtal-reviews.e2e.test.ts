import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The staff review list over real HTTP (group 3.6.c, migration 0046): the
 * routes refuse anyone who is not staff with `manage_operations`, mask the
 * email, never send the sub, and resolve a case once.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('admin: Sign in with YourTal review list — real HTTP', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: (userId: string) => string;

  const STAFF = 'bbbbbbbb-0000-4000-8000-0000000000c1';
  const STAFF_NO_CAP = 'bbbbbbbb-0000-4000-8000-0000000000c2';
  const PLAIN = 'bbbbbbbb-0000-4000-8000-0000000000c3';
  const SUB = `review-e2e-sub-${randomUUID().slice(0, 8)}`;
  let caseId: string;

  const call = (method: 'GET' | 'POST', path: string, as: string | null, payload?: object) =>
    app.inject({
      method,
      url: `/v1/admin/operations/yourtal-reviews${path}`,
      headers: as ? { authorization: `Bearer ${issueSession(as)}` } : {},
      payload,
    });

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    await cleanup();
    await admin.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, 'dev|rv-staff', 'rv-staff@admin.test', 'RV Staff'),
         ($2, 'dev|rv-nocap', 'rv-nocap@admin.test', 'RV No cap'),
         ($3, 'dev|rv-plain', 'rv-plain@admin.test', 'RV Plain')`,
      [STAFF, STAFF_NO_CAP, PLAIN],
    );
    for (const [u, cap] of [[STAFF, 'manage_operations'], [STAFF_NO_CAP, 'view_analytics']]) {
      await admin.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support')`, [u]);
      await admin.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability)
           SELECT id, $2::platform_capability FROM platform_staff WHERE user_id = $1`,
        [u, cap],
      );
    }
    caseId = (
      await admin.query(
        `INSERT INTO yourtal_sign_in_reviews (kind, yourtal_sub, email, user_id)
         VALUES ('unlinkable_account', $1, 'Someone@example.com', $2) RETURNING id`,
        [SUB, PLAIN],
      )
    ).rows[0].id;

    issueSession = await (await import('../test-support/sessions.js')).openSessions(STAFF, STAFF_NO_CAP, PLAIN);
    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  async function cleanup() {
    await admin.query(`DELETE FROM yourtal_sign_in_reviews WHERE yourtal_sub LIKE 'review-e2e-sub-%'`);
    await admin.query(`DELETE FROM audit_log WHERE actor_id = ANY($1)`, [[STAFF, STAFF_NO_CAP]]);
    await admin.query(
      `DELETE FROM platform_staff_capabilities WHERE staff_id IN (SELECT id FROM platform_staff WHERE user_id = ANY($1))`,
      [[STAFF, STAFF_NO_CAP]],
    );
    await admin.query(`DELETE FROM platform_staff WHERE user_id = ANY($1)`, [[STAFF, STAFF_NO_CAP]]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[STAFF, STAFF_NO_CAP, PLAIN]]);
  }

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await app.close();
  });

  it('refuses the list and the resolve to anyone not signed in, not staff, or without manage_operations', async () => {
    expect((await call('GET', '', null)).statusCode).toBe(401);
    for (const who of [PLAIN, STAFF_NO_CAP]) {
      expect((await call('GET', '', who)).statusCode).toBe(403);
      expect((await call('POST', `/${caseId}/resolve`, who, { resolution: 'x' })).statusCode).toBe(403);
    }
    const still = await admin.query('SELECT resolved_at FROM yourtal_sign_in_reviews WHERE id = $1', [caseId]);
    expect(still.rows[0].resolved_at).toBeNull();
  });

  it('lists the case for staff, email masked, no sub', async () => {
    const res = await call('GET', '', STAFF);
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; emailMasked: string; kind: string; userId: string }>;
    const row = rows.find((r) => r.id === caseId)!;
    expect(row).toMatchObject({ kind: 'unlinkable_account', emailMasked: 'S••••@example.com', userId: PLAIN });
    expect(res.body).not.toContain(SUB);
    expect(res.body).not.toContain('Someone@example.com');
  });

  it('validates the resolution and the id', async () => {
    expect((await call('POST', `/${caseId}/resolve`, STAFF, { resolution: '' })).statusCode).toBe(400);
    expect((await call('POST', `/${caseId}/resolve`, STAFF, { resolution: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await call('POST', `/not-a-uuid/resolve`, STAFF, { resolution: 'ok' })).statusCode).toBe(400);
  });

  it('resolves it once, audits it, and answers 404 the second time', async () => {
    const first = await call('POST', `/${caseId}/resolve`, STAFF, { resolution: 'Told the person to use their linked account' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ resolved: true });
    expect((await call('POST', `/${caseId}/resolve`, STAFF, { resolution: 'again' })).statusCode).toBe(404);

    const audit = await admin.query(`SELECT 1 FROM audit_log WHERE actor_id = $1 AND action = 'admin_yourtal_review_resolve' AND entity_id = $2`, [STAFF, caseId]);
    expect(audit.rowCount).toBe(1);
    expect(((await call('GET', '', STAFF)).json() as Array<{ id: string }>).map((r) => r.id)).not.toContain(caseId);
    expect(((await call('GET', '?all=1', STAFF)).json() as Array<{ id: string }>).map((r) => r.id)).toContain(caseId);
  });
});
