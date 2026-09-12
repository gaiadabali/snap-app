import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mintImpersonationToken } from './crypto/impersonation-tokens.js';

/**
 * IMPERSONATION ON THE PRODUCT API — staff acting as a user against the
 * ordinary endpoints a customer uses, not just the admin plane.
 *
 * `admin.e2e.test.ts` covers the admin plane. This covers the far more
 * dangerous half: an impersonation token is now accepted by the SHARED
 * `SessionGuard`, so it reaches every workspace-scoped route in the product.
 * Getting that wrong does not break a support screen, it hands one customer's
 * books to a request scoped for another — or hands a staff member somebody
 * else's admin capabilities.
 *
 * Every test here is a NEGATIVE. The positive path is one test at the end,
 * present only to prove the negatives are not passing because the whole
 * mechanism is inert.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('impersonation on the product API', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: typeof import('../tokens.js').issueSession;

  const STAFF_USER = 'cccccccc-0000-4000-8000-000000000001';
  const OTHER_STAFF = 'cccccccc-0000-4000-8000-000000000002';
  const SUBJECT_USER = 'cccccccc-0000-4000-8000-000000000003';
  const TENANT_A = 'cccccccc-1111-4000-8000-00000000000a';
  const TENANT_B = 'cccccccc-1111-4000-8000-00000000000b';

  const USERS = [STAFF_USER, OTHER_STAFF, SUBJECT_USER];
  const TENANTS = [TENANT_A, TENANT_B];

  /** Mints a live session row directly, so each test controls its own state. */
  async function liveSession(options: {
    subjectUserId?: string;
    tenantId?: string;
    /** Mint a session that has ALREADY expired, rather than a live one. */
    expired?: boolean;
  }): Promise<string> {
    const { token, tokenHash } = mintImpersonationToken();
    await admin.query(
      // An expired row must ALSO satisfy the table's `expires_at > started_at`
      // check, so it is only representable by backdating BOTH — which is
      // exactly how one arises in reality. An earlier version of this helper
      // backdated `started_at` unconditionally, which quietly expired every
      // session in the file and made four unrelated tests fail.
      options.expired
        ? `INSERT INTO impersonation_sessions
             (id, staff_user_id, subject_user_id, subject_tenant_id, reason, token_hash,
              started_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6,
                   now() - interval '2 hours', now() - interval '1 hour')`
        : `INSERT INTO impersonation_sessions
             (id, staff_user_id, subject_user_id, subject_tenant_id, reason, token_hash,
              started_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now(), now() + interval '15 minutes')`,
      [
        randomUUID(),
        STAFF_USER,
        options.subjectUserId ?? SUBJECT_USER,
        options.tenantId ?? TENANT_A,
        'e2e negative-path coverage',
        tokenHash,
      ],
    );
    return token;
  }

  async function cleanup() {
    await admin.query(`DELETE FROM impersonation_sessions WHERE staff_user_id = ANY($1)`, [USERS]);
    await admin.query(
      `DELETE FROM platform_staff_capabilities WHERE staff_id IN
         (SELECT id FROM platform_staff WHERE user_id = ANY($1))`,
      [USERS],
    );
    await admin.query(`DELETE FROM platform_staff WHERE user_id = ANY($1)`, [USERS]);
    await admin.query(`DELETE FROM memberships WHERE user_id = ANY($1)`, [USERS]);
    await admin.query(`DELETE FROM tenants WHERE id = ANY($1)`, [TENANTS]);
    await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS]);
  }

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    // This suite PROVISIONS fixtures — users, tenants, staff rows — which the
    // application role deliberately cannot do: `app_rw` has no grant on
    // `platform_staff` and RLS refuses an insert into `tenants`. Falling back
    // to DATABASE_URL therefore fails deep inside setup with a confusing
    // "permission denied", which is what happened the first time this ran.
    // Say so up front instead.
    const adminUrl = process.env.ADMIN_DATABASE_URL;
    if (!adminUrl) {
      throw new Error(
        'ADMIN_DATABASE_URL is required to run this suite: it provisions staff and tenant ' +
          'fixtures that the application role is correctly forbidden from creating. ' +
          'Point it at a superuser connection (test provisioning only) — see docs/WEB.md §8.',
      );
    }

    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await cleanup();

    await admin.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, 'dev|imp-staff',   'imp-staff@impersonation.test',   'Imp Staff'),
         ($2, 'dev|imp-staff-2', 'imp-staff-2@impersonation.test', 'Other Staff'),
         ($3, 'dev|imp-subject', 'imp-subject@impersonation.test', 'Subject Person')`,
      USERS,
    );
    await admin.query(
      `INSERT INTO tenants (id, name, kind) VALUES ($1, 'Tenant A', 'business'), ($2, 'Tenant B', 'business')`,
      TENANTS,
    );
    await admin.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $2, 'owner')`,
      [TENANT_A, SUBJECT_USER, TENANT_B],
    );

    // Both staff members can impersonate. OTHER_STAFF additionally holds
    // manage_staff — the capability that makes the escalation test meaningful.
    for (const userId of [STAFF_USER, OTHER_STAFF]) {
      await admin.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support')`, [userId]);
      await admin.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability)
           SELECT id, 'impersonate'::platform_capability FROM platform_staff WHERE user_id = $1`,
        [userId],
      );
    }
    await admin.query(
      `INSERT INTO platform_staff_capabilities (staff_id, capability)
         SELECT id, 'manage_staff'::platform_capability FROM platform_staff WHERE user_id = $1`,
      [OTHER_STAFF],
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
    // Guarded: when beforeAll fails partway, these are undefined, and an
    // exception here replaces the real error with a useless one.
    if (admin) {
      await cleanup();
      await admin.end();
    }
    if (app) await app.close();
  });

  const overview = '/v1/overview';

  it('refuses a garbage impersonation token rather than falling through to anonymous', async () => {
    // The dangerous failure is not rejection, it is a token that fails to
    // verify and then quietly continues down the ordinary path.
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': 'imp_not-a-real-token', 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses an EXPIRED session', async () => {
    const token = await liveSession({ expired: true });
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': token, 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a session that was explicitly STOPPED', async () => {
    const token = await liveSession({});
    await admin.query(
      `UPDATE impersonation_sessions SET ended_at = now(), ended_reason = 'stopped'
         WHERE token_hash = digest($1, 'sha256')`,
      [token],
    );
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': token, 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses the moment the staff member loses the impersonate capability', async () => {
    // Verified per REQUEST, not once at session start — otherwise revoking
    // access would not take effect until the session happened to end.
    const token = await liveSession({});
    await admin.query(
      `DELETE FROM platform_staff_capabilities
         WHERE staff_id = (SELECT id FROM platform_staff WHERE user_id = $1)
           AND capability = 'impersonate'`,
      [STAFF_USER],
    );

    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': token, 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(401);

    await admin.query(
      `INSERT INTO platform_staff_capabilities (staff_id, capability)
         SELECT id, 'impersonate'::platform_capability FROM platform_staff WHERE user_id = $1
       ON CONFLICT DO NOTHING`,
      [STAFF_USER],
    );
  });

  it('CANNOT reach a workspace the session was not opened for', async () => {
    // The subject genuinely owns both tenants, so nothing but the pinning
    // check stands between a session opened for A and the books of B.
    const token = await liveSession({ tenantId: TENANT_A });
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': token, 'x-workspace-id': TENANT_B },
    });
    expect(response.statusCode).toBe(403);
  });

  it('CANNOT reach the admin plane, even impersonating a staff member who has capabilities', async () => {
    // The escalation this closes: staff are ordinary users too, so
    // impersonating another staff member would otherwise let StaffGuard look
    // up the SUBJECT's capabilities and hand them over — including
    // manage_staff, which is enough to grant yourself everything else.
    const token = await liveSession({ subjectUserId: OTHER_STAFF });

    for (const route of ['/v1/admin/me', '/v1/admin/staff', '/v1/admin/analytics/overview']) {
      const response = await app.inject({
        method: 'GET',
        url: route,
        headers: { 'x-impersonation-token': token },
      });
      expect(response.statusCode, `${route} must not be reachable under impersonation`).toBe(403);
    }
  });

  it('does not accept an ordinary session token as an impersonation token', async () => {
    const sessionToken = issueSession(STAFF_USER);
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': sessionToken, 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not accept an impersonation token as an ordinary bearer token', async () => {
    const token = await liveSession({});
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(401);
  });

  it('a valid session DOES reach the product, and is audited with both identities', async () => {
    // The positive control. Without it, every negative above would still pass
    // if impersonation were simply broken end to end.
    const token = await liveSession({});
    const response = await app.inject({
      method: 'GET',
      url: overview,
      headers: { 'x-impersonation-token': token, 'x-workspace-id': TENANT_A },
    });
    expect(response.statusCode).toBe(200);

    const audit = await admin.query(
      `SELECT count(*)::int AS n FROM audit_log
         WHERE actor_type = 'platform_staff'
           AND actor_id = $1
           AND action = 'admin_impersonated_request'
           AND after->>'subject_user_id' = $2`,
      [STAFF_USER, SUBJECT_USER],
    );
    expect(
      audit.rows[0]?.n ?? 0,
      'every impersonated request must be attributed to BOTH identities',
    ).toBeGreaterThan(0);
  });
});
