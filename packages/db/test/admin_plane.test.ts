import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * THE PLATFORM ADMIN PLANE — migration 0021.
 *
 * This is the one feature in the codebase whose entire job is to cross the
 * tenant-isolation boundary `current_tenant_id()` on purpose (0010, 0011).
 * The repo has already shipped the catastrophic version of this class of bug
 * once — the server connected as `postgres`, a superuser bypasses RLS
 * entirely, and every test that "proved" isolation proved nothing, because
 * the suite only ever checked the happy path (see 0015's header and
 * `packages/db/test/identity.test.ts`, which this file is modelled on).
 *
 * So every test group here starts with, or IS, the negative case:
 *   - the admin API's own connection role does not have BYPASSRLS,
 *   - a non-staff user cannot call a single admin function,
 *   - a staff member is refused BY THE FUNCTION for every capability they do
 *     not hold, one by one — not just for the one capability that was
 *     convenient to test,
 *   - an expired, revoked, or already-ended impersonation token is rejected,
 *   - a stored AI key is never selectable in plaintext by anything this
 *     migration defines,
 *   - and a normal session token and an impersonation token are proved
 *     mutually unusable as each other, against the REAL verifiers on both
 *     sides (this file's DB calls, and `apps/server/src/tokens.ts`'s own
 *     `readSession`).
 *
 * If any "negative" test here ever starts passing for the wrong reason (e.g.
 * a query that errors is mistaken for a query that correctly returns zero
 * rows), the suite has gone blind exactly the way the original one did.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('admin plane', () => {
  let c: Client;

  // Fixture ids, all under a recognisable prefix so `wipe()` can find them.
  const STAFF_USER = 'aaaaaaaa-0000-4000-8000-000000000001';
  const OTHER_TENANT_USER = 'aaaaaaaa-0000-4000-8000-000000000002'; // not staff
  const SUBJECT_USER = 'aaaaaaaa-0000-4000-8000-000000000003';
  const SUBJECT_TENANT = 'aaaaaaaa-0000-4000-8000-000000000010';
  const OTHER_TENANT = 'aaaaaaaa-0000-4000-8000-000000000011';
  const CAPTURE_ID = 'aaaaaaaa-0000-4000-8000-000000000020';

  let planId: string;

  async function asAppRw(userId: string | null) {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_rw');
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }

  async function asSuperuser() {
    await c.query('RESET ROLE');
  }

  const sha256 = (s: string) => createHash('sha256').update(s).digest();

  async function wipe() {
    await asSuperuser();
    await c.query(`DELETE FROM impersonation_sessions WHERE subject_tenant_id IN ($1,$2)`, [
      SUBJECT_TENANT,
      OTHER_TENANT,
    ]);
    await c.query(`DELETE FROM audit_log WHERE tenant_id IN ($1,$2)`, [SUBJECT_TENANT, OTHER_TENANT]);
    await c.query(`DELETE FROM audit_log WHERE actor_id IN ($1,$2,$3)`, [
      STAFF_USER,
      OTHER_TENANT_USER,
      SUBJECT_USER,
    ]);
    await c.query(`DELETE FROM ai_provider_keys WHERE provider_config_id IN
      (SELECT id FROM ai_provider_configs WHERE label LIKE 'admin-test-%')`);
    await c.query(`DELETE FROM ai_provider_configs WHERE label LIKE 'admin-test-%'`);
    await c.query(`DELETE FROM platform_settings WHERE key LIKE 'admin-test-%'`);
    await c.query(`DELETE FROM captures WHERE id = $1`, [CAPTURE_ID]);
    await c.query(`DELETE FROM subscriptions WHERE tenant_id IN ($1,$2)`, [SUBJECT_TENANT, OTHER_TENANT]);
    await c.query(
      `DELETE FROM platform_staff_capabilities WHERE staff_id IN (SELECT id FROM platform_staff WHERE user_id = ANY($1))`,
      [[STAFF_USER, OTHER_TENANT_USER]],
    );
    await c.query(`DELETE FROM platform_staff WHERE user_id = ANY($1)`, [[STAFF_USER, OTHER_TENANT_USER]]);
    await c.query(`DELETE FROM memberships WHERE tenant_id IN ($1,$2)`, [SUBJECT_TENANT, OTHER_TENANT]);
    await c.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [SUBJECT_TENANT, OTHER_TENANT]);
    await c.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [STAFF_USER, OTHER_TENANT_USER, SUBJECT_USER]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();

    await asSuperuser();
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, 'dev|staff',  'staff@admin.test',  'Staff Member'),
         ($2, 'dev|nobody', 'nobody@admin.test', 'Not Staff'),
         ($3, 'dev|subj',   'subject@admin.test','Subject User')`,
      [STAFF_USER, OTHER_TENANT_USER, SUBJECT_USER],
    );
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency) VALUES
         ($1, 'Admin Test Subject Co', 'business', 'AU', 'AUD'),
         ($2, 'Admin Test Other Co',   'business', 'AU', 'AUD')`,
      [SUBJECT_TENANT, OTHER_TENANT],
    );
    await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      SUBJECT_TENANT,
      SUBJECT_USER,
    ]);
    await c.query(
      `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type,
                              original_byte_size, original_sha256, device_meta)
       VALUES ($1, $2, 'admin-test/original.jpg', 'image/jpeg', 100, $3, '{}'::jsonb)`,
      [CAPTURE_ID, SUBJECT_TENANT, sha256('admin-test-capture')],
    );
    planId = (await c.query<{ id: string }>(`SELECT id FROM plans ORDER BY price_cents LIMIT 1`)).rows[0]!.id;
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  /* ── The role itself: the exact bug that shipped before ───────────────── */

  describe('the connection role', () => {
    it('app_rw — the role every admin route actually connects as — does NOT bypass RLS', async () => {
      await asSuperuser();
      const r = await c.query<{ bypass: boolean; super: boolean }>(
        `SELECT rolbypassrls AS bypass, rolsuper AS super FROM pg_roles WHERE rolname = 'app_rw'`,
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]!.bypass).toBe(false);
      expect(r.rows[0]!.super).toBe(false);
    });

    it('the snap_app login role (if provisioned) does NOT bypass RLS either', async () => {
      await asSuperuser();
      const r = await c.query<{ bypass: boolean; super: boolean }>(
        `SELECT rolbypassrls AS bypass, rolsuper AS super FROM pg_roles WHERE rolname = 'snap_app'`,
      );
      if (r.rows.length === 0) return; // not provisioned in this environment; nothing to assert
      expect(r.rows[0]!.bypass).toBe(false);
      expect(r.rows[0]!.super).toBe(false);
    });

    it('app_platform DOES bypass RLS — the one, documented, auditable exception', async () => {
      await asSuperuser();
      const r = await c.query<{ bypass: boolean; login: boolean }>(
        `SELECT rolbypassrls AS bypass, rolcanlogin AS login FROM pg_roles WHERE rolname = 'app_platform'`,
      );
      expect(r.rows[0]!.bypass).toBe(true);
      // NOLOGIN: nobody can connect AS it. It is a privilege set, not an account.
      expect(r.rows[0]!.login).toBe(false);
    });
  });

  /* ── Nobody but staff, at the table level, not just the function level ── */

  describe('app_rw has no table-level access to the platform tables at all', () => {
    it('cannot SELECT platform_staff directly', async () => {
      await asAppRw(STAFF_USER);
      await expect(c.query('SELECT * FROM platform_staff')).rejects.toThrow(/permission denied/i);
    });

    it('cannot SELECT ai_provider_keys directly (where the ciphertext lives)', async () => {
      await asAppRw(STAFF_USER);
      await expect(c.query('SELECT * FROM ai_provider_keys')).rejects.toThrow(/permission denied/i);
    });

    it('cannot SELECT impersonation_sessions directly', async () => {
      await asAppRw(STAFF_USER);
      await expect(c.query('SELECT * FROM impersonation_sessions')).rejects.toThrow(/permission denied/i);
    });
  });

  /* ── A non-staff user cannot reach a single admin function ─────────────── */

  describe('a non-staff, authenticated user', () => {
    it('is refused by every capability-gated function, not waved through by any of them', async () => {
      await asAppRw(OTHER_TENANT_USER);
      await expect(c.query('SELECT * FROM admin_analytics_overview()')).rejects.toThrow(
        /missing capability: view_analytics/,
      );
      await expect(c.query(`SELECT * FROM admin_tenant_search(NULL, 25, 0)`)).rejects.toThrow(
        /missing capability: view_tenant_metadata/,
      );
      await expect(
        c.query(`SELECT * FROM admin_authorize_tenant_records($1, 'because')`, [SUBJECT_TENANT]),
      ).rejects.toThrow(/missing capability: read_tenant_records/);
      await expect(
        c.query(`SELECT * FROM admin_impersonation_start($1, $2, 'because', $3, 600)`, [
          SUBJECT_USER,
          SUBJECT_TENANT,
          sha256(randomUUID()),
        ]),
      ).rejects.toThrow(/missing capability: impersonate/);
      await expect(
        c.query(`SELECT admin_staff_add($1, 'support', ARRAY[]::platform_capability[])`, [SUBJECT_USER]),
      ).rejects.toThrow(/missing capability: manage_staff/);
      // 0023: reviewing the audit log is its own capability, refused the
      // same way as every other one — see that migration's header for why
      // it is not folded into view_tenant_metadata.
      await expect(c.query(`SELECT * FROM admin_audit_log_search()`)).rejects.toThrow(
        /missing capability: audit_review/,
      );
    });

    it('cannot call staff_has_capability its way into anything — it always reports false for them', async () => {
      await asAppRw(OTHER_TENANT_USER);
      const r = await c.query<{ ok: boolean }>(`SELECT staff_has_capability('view_analytics') AS ok`);
      expect(r.rows[0]!.ok).toBe(false);
    });
  });

  /* ── Every capability, refused one by one for a staff member who lacks it ─ */

  describe('a staff member is refused BY THE DATABASE for every capability they were not granted', () => {
    beforeAll(async () => {
      // Inserted directly as the table owner, NOT via `admin_staff_add` —
      // that function itself requires `manage_staff`, which is exactly the
      // capability this staff member must not have yet. Bootstrapping
      // through the gated function would prove nothing.
      await asSuperuser();
      await c.query(
        `INSERT INTO platform_staff (user_id, role) VALUES ($1, 'support')
           ON CONFLICT (user_id) DO NOTHING`,
        [STAFF_USER],
      );
    });

    // Re-authenticate as the bare staff member using the OWNER connection to
    // grant themself capabilities would defeat the point, so every check
    // below runs as STAFF_USER with nothing granted.

    it.each([
      ['view_analytics', () => c.query('SELECT * FROM admin_analytics_overview()')],
      ['view_tenant_metadata', () => c.query(`SELECT * FROM admin_tenant_search(NULL, 25, 0)`)],
      [
        'view_tenant_metadata',
        () => c.query(`SELECT * FROM admin_user_detail($1)`, [SUBJECT_USER]),
      ],
      [
        'read_tenant_records',
        () => c.query(`SELECT * FROM admin_authorize_tenant_records($1, 'because')`, [SUBJECT_TENANT]),
      ],
      [
        'impersonate',
        () =>
          c.query(`SELECT * FROM admin_impersonation_start($1, $2, 'because', $3, 600)`, [
            SUBJECT_USER,
            SUBJECT_TENANT,
            sha256(randomUUID()),
          ]),
      ],
      [
        'manage_billing',
        () => c.query(`SELECT admin_tenant_set_plan($1, $2, 'because')`, [SUBJECT_TENANT, planId]),
      ],
      [
        'manage_platform_settings',
        () => c.query(`SELECT admin_setting_set('admin-test-key', '{}'::jsonb, 'because')`),
      ],
      [
        'manage_ai_config',
        () => c.query(`SELECT admin_ai_provider_upsert('ollama', 'admin-test-cfg', NULL, true)`),
      ],
      [
        'manage_staff',
        () =>
          c.query(`SELECT admin_staff_add($1, 'support', ARRAY[]::platform_capability[])`, [
            SUBJECT_USER,
          ]),
      ],
      ['manage_operations', () => c.query(`SELECT admin_impersonation_sweep_expired()`)],
      [
        'audit_review',
        // 0023: the audit-log read, refused BY THE DATABASE like every other
        // capability-gated function — not just by the Nest guard.
        () => c.query(`SELECT * FROM admin_audit_log_search()`),
      ],
    ] as const)('lacking "%s" refuses the call that requires it', async (cap, run) => {
      await asAppRw(STAFF_USER);
      await expect(run()).rejects.toThrow(new RegExp(`missing capability: ${cap}`));
    });
  });

  /* ── Capabilities that ARE granted work — the negative tests are not just
        "everything always fails" ──────────────────────────────────────────── */

  describe('a staff member WITH the capability succeeds', () => {
    let staffId: string;

    beforeAll(async () => {
      await asSuperuser();
      // Clean slate: remove whatever the previous describe block granted.
      await c.query(`DELETE FROM platform_staff_capabilities WHERE staff_id IN
        (SELECT id FROM platform_staff WHERE user_id = $1)`, [STAFF_USER]);
      staffId = (await c.query<{ id: string }>(`SELECT id FROM platform_staff WHERE user_id = $1`, [
        STAFF_USER,
      ])).rows[0]!.id;
      await c.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability) SELECT $1, x
           FROM unnest(ARRAY[
             'view_analytics','view_tenant_metadata','read_tenant_records','impersonate',
             'manage_billing','manage_platform_settings','manage_ai_config','manage_staff',
             'manage_operations','audit_review'
           ]::platform_capability[]) AS x`,
        [staffId],
      );
    });

    it('view_analytics: reads the aggregate overview', async () => {
      await asAppRw(STAFF_USER);
      const r = await c.query('SELECT * FROM admin_analytics_overview()');
      expect(r.rows).toHaveLength(1);
      expect(Number(r.rows[0].tenant_count)).toBeGreaterThanOrEqual(2);
    });

    it('view_tenant_metadata: finds the fixture tenant by name and logs the detail view', async () => {
      await asAppRw(STAFF_USER);
      const found = await c.query(`SELECT * FROM admin_tenant_search('Admin Test Subject', 10, 0)`);
      expect(found.rows.some((row: { tenant_id: string }) => row.tenant_id === SUBJECT_TENANT)).toBe(true);

      await c.query(`SELECT * FROM admin_tenant_detail($1)`, [SUBJECT_TENANT]);
      await asSuperuser();
      const logged = await c.query(
        `SELECT 1 FROM audit_log WHERE action = 'admin_view_tenant_metadata' AND entity_id = $1`,
        [SUBJECT_TENANT],
      );
      expect(logged.rows).toHaveLength(1);
    });

    it('view_tenant_metadata: fetches ONE user by id, with their memberships', async () => {
      // 0021 shipped only a substring search, so the console paged through it
      // hunting for a matching id — twenty round trips per page, and silently
      // no result once the user table outgrew the scan bound. This is the
      // endpoint that replaces that; migration 0022 exists for this test.
      await asAppRw(STAFF_USER);
      const r = await c.query(`SELECT * FROM admin_user_detail($1)`, [SUBJECT_USER]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].user_id).toBe(SUBJECT_USER);

      // The membership list and the count beside it are built in the same
      // query precisely so they cannot disagree.
      const memberships = r.rows[0].memberships as Array<{ tenantId: string }>;
      expect(Array.isArray(memberships)).toBe(true);
      expect(Number(r.rows[0].tenant_count)).toBe(memberships.length);
      expect(memberships.some((m) => m.tenantId === SUBJECT_TENANT)).toBe(true);

      await asSuperuser();
      const logged = await c.query(
        `SELECT 1 FROM audit_log WHERE action = 'admin_view_user_metadata' AND entity_id = $1`,
        [SUBJECT_USER],
      );
      expect(logged.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('admin_user_detail: raises rather than returning an empty row for an unknown user', async () => {
      // A silent empty result is what the paging workaround produced, and it
      // is indistinguishable from "this user does not exist" — which is the
      // failure this whole function is here to remove.
      await asAppRw(STAFF_USER);
      await expect(
        c.query(`SELECT * FROM admin_user_detail($1)`, [randomUUID()]),
      ).rejects.toThrow(/no such user/);
    });

    it('read_tenant_records: requires a non-blank reason and logs it', async () => {
      await asAppRw(STAFF_USER);
      await expect(
        c.query(`SELECT * FROM admin_authorize_tenant_records($1, '')`, [SUBJECT_TENANT]),
      ).rejects.toThrow(/reason is required/);

      await c.query(`SELECT * FROM admin_authorize_tenant_records($1, 'customer support ticket #42')`, [
        SUBJECT_TENANT,
      ]);
      await asSuperuser();
      const logged = await c.query<{ after: { reason: string } }>(
        `SELECT after FROM audit_log WHERE action = 'admin_read_tenant_records' AND tenant_id = $1`,
        [SUBJECT_TENANT],
      );
      expect(logged.rows[0]!.after.reason).toBe('customer support ticket #42');
    });

    it('manage_ai_config: stores a key, and NOTHING ever selects it back in plaintext', async () => {
      await asAppRw(STAFF_USER);
      const cfg = await c.query<{ admin_ai_provider_upsert: string }>(
        `SELECT admin_ai_provider_upsert('ollama', 'admin-test-cfg', 'gemma4:31b', true)`,
      );
      const configId = cfg.rows[0]!.admin_ai_provider_upsert;

      const fakeCiphertext = randomBytes(48);
      const fakeWrappedDek = randomBytes(48);
      await c.query(
        `SELECT admin_ai_key_store($1, 'sk-live-', 'abcd', $2, $3, 'local-kek-v1')`,
        [configId, fakeCiphertext, fakeWrappedDek],
      );

      const list = await c.query<{ key_prefix: string; key_last4: string }>(
        `SELECT * FROM admin_ai_provider_list() WHERE id = $1`,
        [configId],
      );
      expect(list.rows[0]!.key_prefix).toBe('sk-live-');
      expect(list.rows[0]!.key_last4).toBe('abcd');
      // The function's own column list has no `ciphertext`/`wrapped_dek` — this
      // asserts it at the wire level too, not just by reading the SQL.
      expect(Object.keys(list.rows[0]!)).not.toContain('ciphertext');
      expect(Object.keys(list.rows[0]!)).not.toContain('wrapped_dek');
    });

    it('manage_operations: triggers a re-extraction job for a capture that belongs to that tenant', async () => {
      await asAppRw(STAFF_USER);
      const job = await c.query<{ admin_trigger_reextraction: string }>(
        `SELECT admin_trigger_reextraction($1, $2, 'reprocessing after a validator fix')`,
        [SUBJECT_TENANT, CAPTURE_ID],
      );
      expect(job.rows[0]!.admin_trigger_reextraction).toBeTruthy();

      await asSuperuser();
      const jobRow = await c.query(`SELECT kind, tenant_id FROM jobs WHERE id = $1`, [
        job.rows[0]!.admin_trigger_reextraction,
      ]);
      expect(jobRow.rows[0]).toMatchObject({ kind: 'extract', tenant_id: SUBJECT_TENANT });
    });

    it('manage_operations: refuses a capture that belongs to a DIFFERENT tenant', async () => {
      await asAppRw(STAFF_USER);
      await expect(
        c.query(`SELECT admin_trigger_reextraction($1, $2, 'because')`, [OTHER_TENANT, CAPTURE_ID]),
      ).rejects.toThrow(/no such capture/);
    });

    // ── Gap 3: admin_my_capabilities names the caller ──────────────────────
    it('admin_my_capabilities: also returns the caller\'s own display_name and email (0023)', async () => {
      await asAppRw(STAFF_USER);
      const r = await c.query<{ display_name: string; email: string }>(
        'SELECT * FROM admin_my_capabilities()',
      );
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows[0]!.display_name).toBe('Staff Member');
      expect(r.rows[0]!.email).toBe('staff@admin.test');
    });

    // ── Gap 2: admin_ai_provider_list exposes the live key's id ────────────
    it('admin_ai_provider_list: the live key\'s own id is returned, so it is revocable from a fresh read (0023)', async () => {
      await asAppRw(STAFF_USER);
      const cfg = await c.query<{ admin_ai_provider_upsert: string }>(
        `SELECT admin_ai_provider_upsert('ollama', 'admin-test-livekeyid', 'gemma4:31b', true)`,
      );
      const configId = cfg.rows[0]!.admin_ai_provider_upsert;
      const stored = await c.query<{ admin_ai_key_store: string }>(
        `SELECT admin_ai_key_store($1, 'sk-live-', 'wxyz', $2, $3, 'local-kek-v1')`,
        [configId, randomBytes(48), randomBytes(48)],
      );
      const keyId = stored.rows[0]!.admin_ai_key_store;

      // A SEPARATE call, as the read this list would serve on a fresh page
      // load — not using the id `admin_ai_key_store` just returned.
      const list = await c.query<{ live_key_id: string; has_live_key: boolean }>(
        `SELECT * FROM admin_ai_provider_list() WHERE id = $1`,
        [configId],
      );
      expect(list.rows[0]!.has_live_key).toBe(true);
      expect(list.rows[0]!.live_key_id).toBe(keyId);

      // And that id genuinely revokes it — proving `live_key_id` is not a
      // decoy value that merely looks like the right shape.
      await c.query(`SELECT admin_ai_key_revoke($1, 'test cleanup')`, [keyId]);
      const afterRevoke = await c.query<{ has_live_key: boolean }>(
        `SELECT * FROM admin_ai_provider_list() WHERE id = $1`,
        [configId],
      );
      expect(afterRevoke.rows[0]!.has_live_key).toBe(false);
    });

    // ── Gap 1: the audit-log read ───────────────────────────────────────────
    describe('audit_review: reading audit_log back', () => {
      it('finds a row it can be certain exists — the view_tenant_metadata read logged earlier in this suite', async () => {
        await asAppRw(STAFF_USER);
        // Filtered by the exact tenant a prior test in this file caused an
        // `admin_view_tenant_metadata` row to be written for.
        const r = await c.query(
          `SELECT * FROM admin_audit_log_search(NULL, $1, 'admin_view_tenant_metadata')`,
          [SUBJECT_TENANT],
        );
        expect(r.rows.length).toBeGreaterThanOrEqual(1);
        expect(r.rows[0]).toMatchObject({ tenant_id: SUBJECT_TENANT, action: 'admin_view_tenant_metadata' });
      });

      it('filters by actor_id and by action independently', async () => {
        await asAppRw(STAFF_USER);
        const byActor = await c.query(`SELECT * FROM admin_audit_log_search($1)`, [STAFF_USER]);
        expect(byActor.rows.length).toBeGreaterThan(0);
        expect(byActor.rows.every((row: { actor_id: string }) => row.actor_id === STAFF_USER)).toBe(true);

        const byAction = await c.query(
          `SELECT * FROM admin_audit_log_search(NULL, NULL, 'admin_staff_add')`,
        );
        expect(byAction.rows.every((row: { action: string }) => row.action === 'admin_staff_add')).toBe(true);
      });

      it('reviewing the audit log is ITSELF audited — the read leaves a trail too', async () => {
        await asAppRw(STAFF_USER);
        await c.query(`SELECT * FROM admin_audit_log_search($1)`, [STAFF_USER]);
        await asSuperuser();
        const logged = await c.query(
          `SELECT after FROM audit_log WHERE action = 'admin_audit_log_search' AND actor_id = $1
             ORDER BY id DESC LIMIT 1`,
          [STAFF_USER],
        );
        expect(logged.rows).toHaveLength(1);
      });

      it('never mutates audit_log — it is append-only; there is no admin_audit_log function that writes another row\'s content', async () => {
        await asAppRw(STAFF_USER);
        await asSuperuser();
        const before = await c.query('SELECT count(*)::int AS n FROM audit_log');
        await asAppRw(STAFF_USER);
        await c.query(`SELECT * FROM admin_audit_log_search()`);
        await asSuperuser();
        const after = await c.query('SELECT count(*)::int AS n FROM audit_log');
        // Exactly ONE new row (the read's own audit entry) — nothing else moved.
        expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
      });
    });
  });

  /* ── Impersonation: the whole lifecycle, and every way it must fail ────── */

  describe('impersonation', () => {
    let staffId: string;

    beforeAll(async () => {
      await asSuperuser();
      staffId = (await c.query<{ id: string }>(`SELECT id FROM platform_staff WHERE user_id = $1`, [
        STAFF_USER,
      ])).rows[0]!.id;
      await c.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability) VALUES ($1, 'impersonate')
           ON CONFLICT DO NOTHING`,
        [staffId],
      );
    });

    it('refuses to impersonate someone who is not a member of the named tenant', async () => {
      await asAppRw(STAFF_USER);
      await expect(
        c.query(`SELECT * FROM admin_impersonation_start($1, $2, 'because', $3, 600)`, [
          SUBJECT_USER,
          OTHER_TENANT, // Subject is a member of SUBJECT_TENANT, not this one.
          sha256(randomUUID()),
        ]),
      ).rejects.toThrow(/not a member of that tenant/);
    });

    it('refuses a blank reason', async () => {
      await asAppRw(STAFF_USER);
      await expect(
        c.query(`SELECT * FROM admin_impersonation_start($1, $2, '   ', $3, 600)`, [
          SUBJECT_USER,
          SUBJECT_TENANT,
          sha256(randomUUID()),
        ]),
      ).rejects.toThrow(/reason is required/);
    });

    it('starts a session, verifies it, and every verified request is attributed to BOTH staff and subject', async () => {
      const rawToken = randomUUID();
      const hash = sha256(rawToken);

      await asAppRw(STAFF_USER);
      const started = await c.query<{ session_id: string; expires_at: string }>(
        `SELECT * FROM admin_impersonation_start($1, $2, 'investigating a billing dispute', $3, 600)`,
        [SUBJECT_USER, SUBJECT_TENANT, hash],
      );
      const sessionId = started.rows[0]!.session_id;
      expect(sessionId).toBeTruthy();

      // Verified as app_rw with NO app.user_id at all — the token itself is
      // the entire credential, exactly like an upload/download/image token.
      await asAppRw(null);
      const verified = await c.query(
        `SELECT * FROM admin_impersonation_verify($1, 'GET', '/v1/documents')`,
        [hash],
      );
      expect(verified.rows).toHaveLength(1);
      expect(verified.rows[0]).toMatchObject({
        session_id: sessionId,
        staff_user_id: STAFF_USER,
        subject_user_id: SUBJECT_USER,
        subject_tenant_id: SUBJECT_TENANT,
      });

      await asSuperuser();
      const audited = await c.query<{ actor_id: string; tenant_id: string; after: { subject_user_id: string } }>(
        `SELECT actor_id, tenant_id, after FROM audit_log
          WHERE action = 'admin_impersonated_request' AND entity_id = $1`,
        [sessionId],
      );
      expect(audited.rows).toHaveLength(1);
      // BOTH principals, in one row: actor is the staff member, tenant_id and
      // the payload's subject_user_id name the person being impersonated.
      expect(audited.rows[0]!.actor_id).toBe(STAFF_USER);
      expect(audited.rows[0]!.tenant_id).toBe(SUBJECT_TENANT);
      expect(audited.rows[0]!.after.subject_user_id).toBe(SUBJECT_USER);
    });

    it('rejects an EXPIRED token — even though it was never explicitly stopped', async () => {
      const rawToken = randomUUID();
      const hash = sha256(rawToken);
      await asAppRw(STAFF_USER);
      await c.query(`SELECT * FROM admin_impersonation_start($1, $2, 'because', $3, 60)`, [
        SUBJECT_USER,
        SUBJECT_TENANT,
        hash,
      ]);

      // Backdate it directly (as the table owner) rather than waiting 60s.
      // Both timestamps move together: `impersonation_expiry_after_start`
      // requires expires_at > started_at, which a real expiry always
      // satisfies too — this only fast-forwards the clock, it does not
      // fake an otherwise-impossible row.
      await asSuperuser();
      await c.query(
        `UPDATE impersonation_sessions
            SET started_at = now() - interval '2 minutes',
                expires_at = now() - interval '1 minute'
          WHERE token_hash = $1`,
        [hash],
      );

      await asAppRw(null);
      const verified = await c.query(`SELECT * FROM admin_impersonation_verify($1, 'GET', '/x')`, [hash]);
      expect(verified.rows).toHaveLength(0);

      await asSuperuser();
      const row = await c.query(`SELECT ended_reason FROM impersonation_sessions WHERE token_hash = $1`, [
        hash,
      ]);
      expect(row.rows[0]!.ended_reason).toBe('expired');
    });

    it('rejects a token that was explicitly STOPPED', async () => {
      const rawToken = randomUUID();
      const hash = sha256(rawToken);
      await asAppRw(STAFF_USER);
      const started = await c.query<{ session_id: string }>(
        `SELECT * FROM admin_impersonation_start($1, $2, 'because', $3, 600)`,
        [SUBJECT_USER, SUBJECT_TENANT, hash],
      );
      await c.query(`SELECT admin_impersonation_stop($1)`, [started.rows[0]!.session_id]);

      await asAppRw(null);
      const verified = await c.query(`SELECT * FROM admin_impersonation_verify($1, 'GET', '/x')`, [hash]);
      expect(verified.rows).toHaveLength(0);

      // And stopping it again is refused outright, not a silent no-op.
      await asAppRw(STAFF_USER);
      await expect(c.query(`SELECT admin_impersonation_stop($1)`, [started.rows[0]!.session_id])).rejects.toThrow(
        /already ended/,
      );
    });

    it('rejects a REVOKED session — a staff member without "impersonate" cannot keep using one already open', async () => {
      const rawToken = randomUUID();
      const hash = sha256(rawToken);
      await asAppRw(STAFF_USER);
      await c.query(`SELECT * FROM admin_impersonation_start($1, $2, 'because', $3, 600)`, [
        SUBJECT_USER,
        SUBJECT_TENANT,
        hash,
      ]);

      // The capability is pulled mid-flight — this staff member should not be
      // able to keep acting as the subject on their NEXT request either.
      await asSuperuser();
      await c.query(
        `DELETE FROM platform_staff_capabilities
           WHERE staff_id = (SELECT id FROM platform_staff WHERE user_id = $1) AND capability = 'impersonate'`,
        [STAFF_USER],
      );

      await asAppRw(null);
      const verified = await c.query(`SELECT * FROM admin_impersonation_verify($1, 'GET', '/x')`, [hash]);
      expect(verified.rows).toHaveLength(0);

      await asSuperuser();
      const row = await c.query(`SELECT ended_reason FROM impersonation_sessions WHERE token_hash = $1`, [
        hash,
      ]);
      expect(row.rows[0]!.ended_reason).toBe('revoked');

      // Restore for any later test in this file that assumes STAFF_USER can impersonate.
      const staffRow = await c.query<{ id: string }>(`SELECT id FROM platform_staff WHERE user_id = $1`, [
        STAFF_USER,
      ]);
      await c.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability) VALUES ($1, 'impersonate')
           ON CONFLICT DO NOTHING`,
        [staffRow.rows[0]!.id],
      );
    });

    it('a token that was never issued verifies to nothing — no error, no row, exactly like a wrong guess', async () => {
      await asAppRw(null);
      const verified = await c.query(`SELECT * FROM admin_impersonation_verify($1, 'GET', '/x')`, [
        sha256(randomUUID()),
      ]);
      expect(verified.rows).toHaveLength(0);
    });
  });

  /* ── Token-format cross-use: the two must be mutually unusable ──────────── */

  describe('an impersonation token and a normal session token are not interchangeable', () => {
    it('a value shaped like an ordinary session token verifies to nothing as an impersonation token', async () => {
      // A real session token from `apps/server/src/tokens.ts` is
      // `base64url(json).base64url(hmac)` — structurally nothing like the
      // random UUID this migration hashes, so its hash matches no row.
      const looksLikeASessionToken = 'eyJrIjoic2Vzc2lvbiJ9.deadbeefdeadbeef';
      await asAppRw(null);
      const verified = await c.query(`SELECT * FROM admin_impersonation_verify($1, 'GET', '/x')`, [
        sha256(looksLikeASessionToken),
      ]);
      expect(verified.rows).toHaveLength(0);
    });

    it('the real session verifier refuses a real impersonation token in return — see apps/server/src/admin/crypto/impersonation-tokens.test.ts for the Node-side half of this proof', async () => {
      // This half stays in packages/db because it is the DB row that has to
      // exist for the other half to be meaningful: prove the token this
      // migration mints is a bare random value with no HMAC structure at all,
      // which is exactly why `readSession` (tokens.ts) cannot parse one — it
      // has no `.` splitting a signed body from a signature.
      const raw = randomUUID();
      expect(raw.includes('.')).toBe(false);
    });
  });
});
