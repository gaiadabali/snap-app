import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * THE ADMIN PLANE, THROUGH REAL HTTP — not a unit test of a guard in
 * isolation, and not a call to a Postgres function directly (that is
 * `packages/db/test/admin_plane.test.ts`'s job). This boots the actual Nest
 * application on the actual Fastify adapter, with the actual `AdminModule`
 * wired into `AppModule` exactly as `main.ts` wires it, and drives it with
 * real bearer tokens minted by the real `issueSession` — because a guard
 * that is individually correct can still be wired to the wrong controller,
 * or never applied at all, and only booting the real app catches that.
 *
 * This is the project's own stated lesson (see `apps/server/src/app.module.ts`'s
 * `/v1/ready` and 0015's header): the catastrophic version of this bug was
 * "every unit test passed because nothing exercised the real connection
 * role." So every scenario here is the negative case first.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('admin plane — real HTTP', () => {
  let app: NestFastifyApplication;
  let admin: Client; // superuser fixture connection — never what the app connects as
  let issueSession: typeof import('../tokens.js').issueSession;

  const STAFF_USER = 'bbbbbbbb-0000-4000-8000-000000000001';
  const PLAIN_USER = 'bbbbbbbb-0000-4000-8000-000000000002';

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    await admin.query(`DELETE FROM platform_staff_capabilities WHERE staff_id IN
      (SELECT id FROM platform_staff WHERE user_id = ANY($1))`, [[STAFF_USER, PLAIN_USER]]);
    await admin.query(`DELETE FROM platform_staff WHERE user_id = ANY($1)`, [[STAFF_USER, PLAIN_USER]]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[STAFF_USER, PLAIN_USER]]);
    await admin.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, 'dev|e2e-staff', 'e2e-staff@admin.test', 'E2E Staff'),
         ($2, 'dev|e2e-plain', 'e2e-plain@admin.test', 'E2E Plain')`,
      [STAFF_USER, PLAIN_USER],
    );
    await admin.query(
      `INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support')`,
      [STAFF_USER],
    );
    await admin.query(
      `INSERT INTO platform_staff_capabilities (staff_id, capability)
         SELECT id, 'view_analytics'::platform_capability FROM platform_staff WHERE user_id = $1`,
      [STAFF_USER],
    );

    const tokens = await import('../tokens.js');
    issueSession = tokens.issueSession;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM platform_staff_capabilities WHERE staff_id IN
      (SELECT id FROM platform_staff WHERE user_id = ANY($1))`, [[STAFF_USER, PLAIN_USER]]);
    await admin.query(`DELETE FROM platform_staff WHERE user_id = ANY($1)`, [[STAFF_USER, PLAIN_USER]]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[STAFF_USER, PLAIN_USER]]);
    await admin.end();
    await app.close();
  });

  it('refuses every admin route with no Authorization header at all — 401', async () => {
    const overview = await app.inject({ method: 'GET', url: '/v1/admin/analytics/overview' });
    expect(overview.statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/v1/admin/me' });
    expect(me.statusCode).toBe(401);
    const staff = await app.inject({ method: 'GET', url: '/v1/admin/staff' });
    expect(staff.statusCode).toBe(401);
  });

  it('refuses a plain, signed-in, non-staff user — 403, not 200', async () => {
    const token = issueSession(PLAIN_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/overview',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a staff member who lacks the specific capability the route requires — 403', async () => {
    // STAFF_USER holds only "view_analytics" — never granted "manage_staff".
    const token = issueSession(STAFF_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/staff',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a staff member reach the route their capability actually covers — 200, with the real contract shape', async () => {
    const token = issueSession(STAFF_USER);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/analytics/overview',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Same field names as `AdminAnalyticsOverview` — proves the controller's
    // annotated return type is what actually leaves the process, not just
    // what TypeScript believed at compile time.
    expect(body).toHaveProperty('tenantCount');
    expect(body).toHaveProperty('extractionSuccessRate');
    expect(body).toHaveProperty('costAud30d');
    expect(typeof body.tenantCount).toBe('number');
  });

  it('a session token cannot be used as an X-Impersonation-Token — the tenant-records route refuses it', async () => {
    const token = issueSession(STAFF_USER);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/tenants/${randomUUID()}/documents`,
      headers: { 'x-impersonation-token': token }, // a REAL session token, wrong slot
    });
    // Looked up by hash in `impersonation_sessions`, which holds no row for
    // any session token's hash — rejected as an invalid impersonation token,
    // not silently accepted as a signed-in staff session.
    expect(res.statusCode).toBe(401);
  });

  it('returns capabilities as a real ARRAY over the wire, not a Postgres array literal', async () => {
    // This is a runtime-only violation and `tsc` cannot see it. `admin_staff_list()`
    // returns `platform_capability[]`, a custom enum array; `pg` has no type
    // parser for an OID this migration invented, so the column arrived as the
    // STRING '{impersonate,manage_staff}' while satisfying
    // `AdminStaffSummary.capabilities: PlatformCapability[]` at compile time.
    // Any UI mapping over it iterated characters.
    //
    // Asserted here, over real HTTP, because that is the only layer where the
    // difference is observable — the fix is a `::text[]` cast in the repo.
    await admin.query(
      `INSERT INTO platform_staff_capabilities (staff_id, capability)
         SELECT id, 'manage_staff'::platform_capability FROM platform_staff WHERE user_id = $1
       ON CONFLICT DO NOTHING`,
      [STAFF_USER],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/staff',
      headers: { authorization: `Bearer ${issueSession(STAFF_USER)}` },
    });
    expect(res.statusCode).toBe(200);

    const rows = res.json() as Array<{ capabilities: unknown }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        Array.isArray(row.capabilities),
        `capabilities came back as ${typeof row.capabilities}: ${JSON.stringify(row.capabilities)}`,
      ).toBe(true);
    }

    await admin.query(
      `DELETE FROM platform_staff_capabilities
         WHERE staff_id = (SELECT id FROM platform_staff WHERE user_id = $1)
           AND capability = 'manage_staff'`,
      [STAFF_USER],
    );
  });

  it('the admin surface reports the real database role, and it does not bypass RLS', async () => {
    // Not an admin route — `/v1/ready` — but the exact assertion this whole
    // plane exists to never regress: the process this suite just booted is
    // not connected as a role that makes every guard above decorative.
    const ready = await app.inject({ method: 'GET', url: '/v1/ready' });
    const body = ready.json();
    expect(body.rlsEnforced).toBe(true);
  });
});
