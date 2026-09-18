import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TENANT ISOLATION — the gate nothing ships without.
 *
 * Runs on a single connection (not a pool) so `SET ROLE` persists across
 * statements, and exercises the policies as the real application roles rather
 * than as a superuser, who bypasses RLS entirely and would make every assertion
 * here pass vacuously.
 *
 * Requires DATABASE_URL from `pnpm db:up && pnpm db:migrate`.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const A = 'aaaaaaaa-1111-1111-1111-111111111111';
const B = 'bbbbbbbb-2222-2222-2222-222222222222';

describeIfDb('RLS tenant isolation', () => {
  let c: Client;

  /** Run as an application role with an optional tenant context. */
  async function asRole(role: string, tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    if (tenantId) {
      await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    } else {
      await c.query(`SELECT set_config('app.tenant_id', '', false)`);
    }
  }

  const count = async (table: string): Promise<number> => {
    const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
    return Number(r.rows[0].n);
  };

  const expectRejected = async (sqlText: string, params: unknown[] = []) => {
    await expect(c.query(sqlText, params as never[])).rejects.toThrow();
  };

  /**
   * Ordered teardown. `captures.tenant_id` is ON DELETE RESTRICT deliberately —
   * a capture is the ATO legal record and must not vanish because a parent row
   * was removed — so fixtures cannot be cleared by deleting the tenant. Children
   * come first, in dependency order.
   */
  async function wipeFixtures() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    const ids = [[A, B]];
    await c.query(`DELETE FROM jobs WHERE kind = 'rls_probe'`);
    await c.query('DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM transaction_splits WHERE tenant_id = ANY($1::uuid[])', ids);
    // transactions BEFORE event_observations/match_candidates, deliberately —
    // not just for the FK (transaction_id CASCADEs either order). 0032's
    // deferred trigger 2 re-checks `transactions.document_id` against the
    // register on every DELETE of event_observations, evaluated at the end
    // of THIS statement since wipeFixtures runs outside an explicit
    // transaction (each call autocommits). Deleting transactions first means
    // the cascade that removes their event_observations rows finds no
    // transaction left to check against (the function's own "transaction
    // gone -> nothing to judge" branch) instead of finding a still-'posted'
    // row whose document_id now disagrees with a just-deleted observation.
    await c.query('DELETE FROM transactions WHERE tenant_id = ANY($1::uuid[])', ids);
    // Explicit and redundant with the cascade above by design — same
    // "safe even if a future migration tightens a cascade to RESTRICT"
    // reasoning this function's own header states. document_id and
    // statement_line_id on event_observations are plain REFERENCES (no
    // cascade — "evidence outlives links"), so both must be gone before
    // statement_lines/documents below regardless.
    await c.query('DELETE FROM match_candidates WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM event_observations WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM statement_lines WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM statements WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM financial_accounts WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM documents WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM document_field_grounding WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM document_layouts WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM capture_pages WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM accounts WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM categories WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', ids);
    await c.query('DELETE FROM users WHERE subject = ANY($1::text[])', [['idp|a', 'idp|b']]);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query('RESET ROLE'); // seed as superuser: RLS is bypassed
    await wipeFixtures(); // idempotent across runs

    // One explicit transaction for the whole fixture graph, not one implicit
    // transaction per statement (the pg client's default). This matters as
    // of 0032: `transactions` ('e1111111…', 'e2222222…') is inserted with
    // `document_id` already set, and trigger 2's deferred check for that
    // requires the matching `event_observations` row to exist BY COMMIT, not
    // by the time of the `transactions` INSERT itself. Autocommit-per-
    // statement would fail that check before the observation row a few
    // statements below ever lands — exactly the ordering DEFERRABLE
    // INITIALLY DEFERRED exists to allow within one real transaction.
    await c.query('BEGIN');
    await c.query(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant A'), ($2,'Tenant B')`, [A, B]);
    await c.query(`
      INSERT INTO users (id, subject, email) VALUES
        ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa','idp|a','a@example.com'),
        ('22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb','idp|b','b@example.com')`);
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
        ($1,'11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa','owner'),
        ($2,'22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb','owner')`,
      [A, B],
    );
    await c.query(
      `INSERT INTO accounts (id, tenant_id, code, name, account_type) VALUES
        ('a1111111-0000-0000-0000-000000000001',$1,'6-1200','Fuel A','expense'),
        ('a1111111-0000-0000-0000-000000000002',$1,'2-1200','Card A','liability'),
        ('b2222222-0000-0000-0000-000000000001',$2,'6-1200','Fuel B','expense'),
        ('b2222222-0000-0000-0000-000000000002',$2,'2-1200','Card B','liability')`,
      [A, B],
    );
    await c.query(
      `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256) VALUES
        ('c1111111-0000-0000-0000-000000000001',$1,'ka','image/jpeg',100, digest('rls-a','sha256')),
        ('c2222222-0000-0000-0000-000000000001',$2,'kb','image/jpeg',100, digest('rls-b','sha256'))`,
      [A, B],
    );
    await c.query(
      `INSERT INTO documents (id, tenant_id, capture_id, doc_type, is_tax_invoice, issue_date) VALUES
        ('d1111111-0000-0000-0000-000000000001',$1,'c1111111-0000-0000-0000-000000000001','tax_invoice',true,'2026-09-01'),
        ('d2222222-0000-0000-0000-000000000001',$2,'c2222222-0000-0000-0000-000000000001','tax_invoice',true,'2026-09-01')`,
      [A, B],
    );
    await c.query(
      `INSERT INTO transactions (id, tenant_id, txn_date, status, posted_at, source, document_id) VALUES
        ('e1111111-0000-0000-0000-000000000001',$1,'2026-09-01','posted',now(),'scan','d1111111-0000-0000-0000-000000000001'),
        ('e2222222-0000-0000-0000-000000000001',$2,'2026-09-01','posted',now(),'scan','d2222222-0000-0000-0000-000000000001')`,
      [A, B],
    );
    await c.query(
      `INSERT INTO transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount) VALUES
        (gen_random_uuid(),$1,'e1111111-0000-0000-0000-000000000001',1,'a1111111-0000-0000-0000-000000000001', 100.0000,(SELECT id FROM tax_codes WHERE code='GST' AND tenant_id IS NULL),10.0000),
        (gen_random_uuid(),$1,'e1111111-0000-0000-0000-000000000001',2,'a1111111-0000-0000-0000-000000000002',-100.0000,NULL,0),
        (gen_random_uuid(),$2,'e2222222-0000-0000-0000-000000000001',1,'b2222222-0000-0000-0000-000000000001', 500.0000,(SELECT id FROM tax_codes WHERE code='GST' AND tenant_id IS NULL),50.0000),
        (gen_random_uuid(),$2,'e2222222-0000-0000-0000-000000000001',2,'b2222222-0000-0000-0000-000000000002',-500.0000,NULL,0)`,
      [A, B],
    );
    await c.query(
      `INSERT INTO jobs (id, tenant_id, kind) VALUES
        (gen_random_uuid(),$1,'rls_probe'),
        (gen_random_uuid(),$2,'rls_probe'),
        (gen_random_uuid(),NULL,'rls_probe')`,
      [A, B],
    );
    await c.query(
      `INSERT INTO capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256) VALUES
        (gen_random_uuid(),$1,'c1111111-0000-0000-0000-000000000001',1,'a-p1','image/jpeg',100,digest('cp-a-1','sha256')),
        (gen_random_uuid(),$1,'c1111111-0000-0000-0000-000000000001',2,'a-p2','image/jpeg',100,digest('cp-a-2','sha256')),
        (gen_random_uuid(),$2,'c2222222-0000-0000-0000-000000000001',1,'b-p1','image/jpeg',100,digest('cp-b-1','sha256'))`,
      [A, B],
    );
    await c.query(
      // Fixed ids, not gen_random_uuid(), because document_field_grounding's
      // fixtures below need a layout_id to reference — same reasoning
      // captures/documents already use fixed ids throughout this file.
      `INSERT INTO document_layouts (id, tenant_id, capture_id, storage_key, docdom_version, page_count) VALUES
        ('f1111111-0000-0000-0000-000000000001',$1,'c1111111-0000-0000-0000-000000000001','a/layouts/c1/r1.json','docdom-1',1),
        ('f1111111-0000-0000-0000-000000000002',$1,'c1111111-0000-0000-0000-000000000001','a/layouts/c1/r2.json','docdom-1',1),
        ('f2222222-0000-0000-0000-000000000001',$2,'c2222222-0000-0000-0000-000000000001','b/layouts/c2/r1.json','docdom-1',1)`,
      [A, B],
    );
    await c.query(
      // One grounded + one ungrounded row for tenant A (on the same layout,
      // exercising the CHECK's two legal states), one grounded row for B.
      `INSERT INTO document_field_grounding
         (id, tenant_id, capture_id, layout_id, field_path, value, grounded, span_ids, box, page, confidence) VALUES
        (gen_random_uuid(),$1,'c1111111-0000-0000-0000-000000000001','f1111111-0000-0000-0000-000000000002',
         'header.payable_amount','110.00',true,ARRAY['s1'],'{"x0":0,"y0":0,"x1":1,"y1":1}'::jsonb,1,0.9876),
        (gen_random_uuid(),$1,'c1111111-0000-0000-0000-000000000001','f1111111-0000-0000-0000-000000000002',
         'header.supplier_abn','12345678901',false,'{}'::text[],NULL,NULL,0),
        (gen_random_uuid(),$2,'c2222222-0000-0000-0000-000000000001','f2222222-0000-0000-0000-000000000001',
         'header.payable_amount','550.00',true,ARRAY['s2'],'{"x0":0,"y0":0,"x1":1,"y1":1}'::jsonb,1,0.9500)`,
      [A, B],
    );
    await c.query(
      // financial_accounts (0031): links to the 'Card' liability accounts already
      // seeded above, one per tenant.
      `INSERT INTO financial_accounts (id, tenant_id, account_id, institution, account_type, currency) VALUES
        ('fa111111-0000-0000-0000-000000000001',$1,'a1111111-0000-0000-0000-000000000002','Test Bank A','credit_card','AUD'),
        ('fa222222-0000-0000-0000-000000000001',$2,'b2222222-0000-0000-0000-000000000002','Test Bank B','credit_card','AUD')`,
      [A, B],
    );
    await c.query(
      // statements (0031): reuses the documents already seeded above as the
      // statement's immutable original — the fixture only needs a real
      // document_id, not one classified doc_type='statement'.
      `INSERT INTO statements (id, tenant_id, document_id, financial_account_id, period_start, period_end, opening_balance, closing_balance) VALUES
        ('ba111111-0000-0000-0000-000000000001',$1,'d1111111-0000-0000-0000-000000000001','fa111111-0000-0000-0000-000000000001','2026-08-01','2026-08-31',100.0000,200.0000),
        ('ba222222-0000-0000-0000-000000000001',$2,'d2222222-0000-0000-0000-000000000001','fa222222-0000-0000-0000-000000000001','2026-08-01','2026-08-31',500.0000,600.0000)`,
      [A, B],
    );
    await c.query(
      // statement_lines (0031): one observed movement per tenant.
      `INSERT INTO statement_lines (id, tenant_id, statement_id, line_number, posted_date, description_raw, amount_signed) VALUES
        (gen_random_uuid(),$1,'ba111111-0000-0000-0000-000000000001',1,'2026-08-05','COFFEE SHOP A',15.5000),
        (gen_random_uuid(),$2,'ba222222-0000-0000-0000-000000000001',1,'2026-08-05','COFFEE SHOP B',25.5000)`,
      [A, B],
    );
    await c.query(
      // event_observations (0032): the document observation for each
      // tenant's already-posted, document-backed transaction — the same
      // shape 0032's own backfill produces.
      `INSERT INTO event_observations (id, tenant_id, transaction_id, kind, document_id, confirmed_at) VALUES
        ('eb111111-0000-0000-0000-000000000001',$1,'e1111111-0000-0000-0000-000000000001','document','d1111111-0000-0000-0000-000000000001',now()),
        ('eb222222-0000-0000-0000-000000000001',$2,'e2222222-0000-0000-0000-000000000001','document','d2222222-0000-0000-0000-000000000001',now())`,
      [A, B],
    );
    await c.query(
      // match_candidates (0032): one matcher-suggested pair for tenant A,
      // against A's own statement line and document.
      `INSERT INTO match_candidates (id, tenant_id, statement_line_id, document_id, proposed_by)
       SELECT 'ca111111-0000-0000-0000-000000000001', $1, sl.id, 'd1111111-0000-0000-0000-000000000001', 'matcher'
         FROM statement_lines sl WHERE sl.tenant_id = $1`,
      [A],
    );
    await c.query(
      // Same, for tenant B.
      `INSERT INTO match_candidates (id, tenant_id, statement_line_id, document_id, proposed_by)
       SELECT 'ca222222-0000-0000-0000-000000000001', $1, sl.id, 'd2222222-0000-0000-0000-000000000001', 'matcher'
         FROM statement_lines sl WHERE sl.tenant_id = $1`,
      [B],
    );
    // Commits the whole fixture graph in one go — see the BEGIN note above.
    // This is also the point at which 0006's deferred balance trigger and
    // 0032's two deferred observation triggers all evaluate for the first
    // time; a fixture that violates any of them fails HERE, loudly, rather
    // than shipping a beforeAll that silently built something invalid.
    await c.query('COMMIT');
  });

  afterAll(async () => {
    if (!c) return;
    await wipeFixtures();
    await c.end();
  });

  it('app_rw with tenant A sees only tenant A rows', async () => {
    await asRole('app_rw', A);
    expect(await count('documents')).toBe(1);
    expect(await count('transactions')).toBe(1);
    expect(await count('transaction_splits')).toBe(2);
    expect(await count('accounts')).toBe(2);
    expect(await count('captures')).toBe(1);
    expect(await count('tenants')).toBe(1); // itself only
  });

  it("returns A's amounts, not B's — proving it is real isolation, not an empty set", async () => {
    await asRole('app_rw', A);
    const r = await c.query<{ net_amount: string }>('SELECT net_amount FROM v_bas_lines');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].net_amount).toBe('100.0000');
  });

  it('hides tenant B rows even when addressed by primary key', async () => {
    await asRole('app_rw', A);
    const r = await c.query(`SELECT 1 FROM documents WHERE id = 'd2222222-0000-0000-0000-000000000001'`);
    expect(r.rowCount).toBe(0);
  });

  // A view executes as its owner unless security_invoker is set, which would
  // let v_bas_lines return every tenant's GST. This is the assertion that
  // catches that regression.
  it('applies RLS inside views (security_invoker)', async () => {
    await asRole('app_rw', B);
    const r = await c.query<{ net_amount: string }>('SELECT net_amount FROM v_bas_lines');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].net_amount).toBe('500.0000');
  });

  it('fails closed with no tenant context', async () => {
    await asRole('app_rw', null);
    expect(await count('documents')).toBe(0);
    expect(await count('transactions')).toBe(0);
    expect(await count('v_bas_lines')).toBe(0);
  });

  it('rejects a write into another tenant', async () => {
    await asRole('app_rw', A);
    await expectRejected(
      `INSERT INTO accounts (id, tenant_id, code, name, account_type)
       VALUES (gen_random_uuid(), $1, '9-9999', 'Smuggled', 'expense')`,
      [B],
    );
    await c.query('RESET ROLE');
    const r = await c.query(`SELECT 1 FROM accounts WHERE code = '9-9999'`);
    expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
  });

  it('keeps audit_log append-only', async () => {
    await asRole('app_rw', A);
    await c.query(
      `INSERT INTO audit_log (tenant_id, actor_type, action, entity_type)
       VALUES ($1,'user','document.corrected','documents')`,
      [A],
    );
    expect(await count('audit_log')).toBe(1);

    // Revoked privileges, not merely a policy — a policy would still permit a
    // matching UPDATE.
    await expectRejected(`UPDATE audit_log SET action = 'tampered'`);
    await expectRejected(`DELETE FROM audit_log`);
  });

  it('lets the worker drain the whole queue but read no tenant data', async () => {
    await asRole('app_worker', null);
    expect(await count(`jobs WHERE kind = 'rls_probe'`)).toBe(3); // A, B, and system
    expect(await count('documents')).toBe(0);
    expect(await count('transactions')).toBe(0);
  });

  it('confines the worker to one tenant once it sets context from the job', async () => {
    await asRole('app_worker', B);
    expect(await count('documents')).toBe(1);
    const r = await c.query<{ net_amount: string }>('SELECT net_amount FROM v_bas_lines');
    expect(r.rows[0].net_amount).toBe('500.0000');
  });

  // capture_pages (migration 0018): the worker is an ORDINARY app_rw member on
  // this table — unlike `jobs`, it gets no elevated policy — so every one of
  // these is a regression test for "no bypass", not just "tenant isolation".
  describe('capture_pages', () => {
    it('app_rw with tenant A sees only tenant A pages', async () => {
      await asRole('app_rw', A);
      expect(await count('capture_pages')).toBe(2);
    });

    it('switching tenant context changes the visible set', async () => {
      await asRole('app_rw', A);
      expect(await count('capture_pages')).toBe(2);
      await asRole('app_rw', B);
      expect(await count('capture_pages')).toBe(1);
    });

    it('hides another tenant’s pages even when addressed by capture_id', async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM capture_pages WHERE capture_id = 'c2222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it('rejects a write into another tenant', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO capture_pages (id, tenant_id, capture_id, page_number, storage_key, mime_type, byte_size, sha256)
         VALUES (gen_random_uuid(), $1, 'c2222222-0000-0000-0000-000000000001', 2, 'smuggled', 'image/jpeg', 100, digest('smuggled','sha256'))`,
        [B],
      );
      await c.query('RESET ROLE');
      const r = await c.query(`SELECT 1 FROM capture_pages WHERE storage_key = 'smuggled'`);
      expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
    });

    it('fails closed with no tenant context', async () => {
      await asRole('app_rw', null);
      expect(await count('capture_pages')).toBe(0);
    });

    it('grants the worker NO bypass here — unlike jobs, this is an ordinary tenant table', async () => {
      await asRole('app_worker', null);
      expect(await count('capture_pages')).toBe(0);
      await asRole('app_worker', B);
      expect(await count('capture_pages')).toBe(1);
    });
  });

  // document_layouts (migration 0019): same shape as capture_pages — the
  // worker is an ORDINARY app_rw member, no elevated policy — so this proves
  // "no bypass was granted" for the DocDOM pointer table too.
  describe('document_layouts', () => {
    it('app_rw with tenant A sees only tenant A layouts', async () => {
      await asRole('app_rw', A);
      expect(await count('document_layouts')).toBe(2);
    });

    it('switching tenant context changes the visible set', async () => {
      await asRole('app_rw', A);
      expect(await count('document_layouts')).toBe(2);
      await asRole('app_rw', B);
      expect(await count('document_layouts')).toBe(1);
    });

    it('hides another tenant’s layouts even when addressed by capture_id', async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM document_layouts WHERE capture_id = 'c2222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it('rejects a write into another tenant', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO document_layouts (id, tenant_id, capture_id, storage_key, docdom_version, page_count)
         VALUES (gen_random_uuid(), $1, 'c2222222-0000-0000-0000-000000000001', 'smuggled', 'docdom-1', 1)`,
        [B],
      );
      await c.query('RESET ROLE');
      const r = await c.query(`SELECT 1 FROM document_layouts WHERE storage_key = 'smuggled'`);
      expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
    });

    it('fails closed with no tenant context', async () => {
      await asRole('app_rw', null);
      expect(await count('document_layouts')).toBe(0);
    });

    it('grants the worker NO bypass here — unlike jobs, this is an ordinary tenant table', async () => {
      await asRole('app_worker', null);
      expect(await count('document_layouts')).toBe(0);
      await asRole('app_worker', B);
      expect(await count('document_layouts')).toBe(1);
    });
  });

  // document_field_grounding (migration 0020): same shape as capture_pages
  // and document_layouts — the worker is an ORDINARY app_rw member, no
  // elevated policy — so this proves "no bypass" for the grounding table too.
  describe('document_field_grounding', () => {
    it('app_rw with tenant A sees only tenant A grounding rows', async () => {
      await asRole('app_rw', A);
      expect(await count('document_field_grounding')).toBe(2);
    });

    it('switching tenant context changes the visible set', async () => {
      await asRole('app_rw', A);
      expect(await count('document_field_grounding')).toBe(2);
      await asRole('app_rw', B);
      expect(await count('document_field_grounding')).toBe(1);
    });

    it('hides another tenant’s rows even when addressed by layout_id', async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM document_field_grounding WHERE layout_id = 'f2222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it('rejects a write into another tenant', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO document_field_grounding
           (id, tenant_id, capture_id, layout_id, field_path, value, grounded)
         VALUES (gen_random_uuid(), $1, 'c2222222-0000-0000-0000-000000000001',
                 'f2222222-0000-0000-0000-000000000001', 'header.smuggled', 'x', false)`,
        [B],
      );
      await c.query('RESET ROLE');
      const r = await c.query(`SELECT 1 FROM document_field_grounding WHERE field_path = 'header.smuggled'`);
      expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
    });

    it('fails closed with no tenant context', async () => {
      await asRole('app_rw', null);
      expect(await count('document_field_grounding')).toBe(0);
    });

    it('grants the worker NO bypass here — unlike jobs, this is an ordinary tenant table', async () => {
      await asRole('app_worker', null);
      expect(await count('document_field_grounding')).toBe(0);
      await asRole('app_worker', B);
      expect(await count('document_field_grounding')).toBe(1);
    });

    // Regression for the CHECK added in 0020: a grounded row without a box,
    // and an ungrounded row that claims one, must both be rejected — the
    // invariant is enforced by Postgres, not merely documented.
    it('rejects a grounded row with no box', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO document_field_grounding
           (id, tenant_id, capture_id, layout_id, field_path, value, grounded, box, page)
         VALUES (gen_random_uuid(), $1, 'c1111111-0000-0000-0000-000000000001',
                 'f1111111-0000-0000-0000-000000000002', 'header.issue_date', '2026-09-01', true, NULL, NULL)`,
        [A],
      );
    });

    it('rejects an ungrounded row that claims a box', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO document_field_grounding
           (id, tenant_id, capture_id, layout_id, field_path, value, grounded, box, page)
         VALUES (gen_random_uuid(), $1, 'c1111111-0000-0000-0000-000000000001',
                 'f1111111-0000-0000-0000-000000000002', 'header.issue_date', '2026-09-01', false,
                 '{"x0":0,"y0":0,"x1":1,"y1":1}'::jsonb, 1)`,
        [A],
      );
    });
  });

  // financial_accounts / statements / statement_lines (migration 0031,
  // docs/STATEMENTS.md Lane T ticket T3): same ordinary-tenant-table shape as
  // capture_pages and document_layouts — no elevated worker policy — so this
  // is the negative-case suite T3's done-when calls for: a tenant is
  // REFUSED another tenant's statement lines, asserted with a raw query
  // under `withTenant` (asRole here), not merely allowed through its own.
  describe('financial_accounts / statements / statement_lines', () => {
    it('app_rw with tenant A sees only tenant A rows', async () => {
      await asRole('app_rw', A);
      expect(await count('financial_accounts')).toBe(1);
      expect(await count('statements')).toBe(1);
      expect(await count('statement_lines')).toBe(1);
    });

    it('switching tenant context changes the visible set', async () => {
      await asRole('app_rw', A);
      expect(await count('statement_lines')).toBe(1);
      await asRole('app_rw', B);
      expect(await count('statement_lines')).toBe(1);
      const r = await c.query<{ description_raw: string }>('SELECT description_raw FROM statement_lines');
      expect(r.rows[0].description_raw).toBe('COFFEE SHOP B');
    });

    it("hides another tenant's statement lines even when addressed by statement_id", async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM statement_lines WHERE statement_id = 'ba222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it("hides another tenant's financial account even when addressed by id", async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM financial_accounts WHERE id = 'fa222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it('rejects a write into another tenant', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO statement_lines (id, tenant_id, statement_id, line_number, posted_date, description_raw, amount_signed)
         VALUES (gen_random_uuid(), $1, 'ba222222-0000-0000-0000-000000000001', 2, '2026-08-06', 'SMUGGLED', 1.0000)`,
        [B],
      );
      await c.query('RESET ROLE');
      const r = await c.query(`SELECT 1 FROM statement_lines WHERE description_raw = 'SMUGGLED'`);
      expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
    });

    it('fails closed with no tenant context', async () => {
      await asRole('app_rw', null);
      expect(await count('financial_accounts')).toBe(0);
      expect(await count('statements')).toBe(0);
      expect(await count('statement_lines')).toBe(0);
    });

    it('grants the worker NO bypass here — an ordinary tenant table, unlike jobs', async () => {
      await asRole('app_worker', null);
      expect(await count('statement_lines')).toBe(0);
      await asRole('app_worker', B);
      expect(await count('statement_lines')).toBe(1);
    });
  });

  // match_candidates / event_observations (migration 0032, docs/STATEMENTS.md
  // §5.3.1, Lane R ticket R5a): same ordinary-tenant-table shape as
  // capture_pages and financial_accounts — no elevated worker policy. Proven
  // NOT vacuous the same way 0031's suite was: for each table, temporarily
  // `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` and re-run this describe
  // block — every one of the "hides"/"rejects"/"fails closed" cases below
  // must flip to failing before the fix is re-applied. Done by hand for this
  // ticket (see the PR/ticket notes), not automated here, because flipping
  // RLS off mid-suite for one table and back on again is exactly the kind of
  // state a shared test database should not carry between runs.
  describe('match_candidates / event_observations', () => {
    it('app_rw with tenant A sees only tenant A rows', async () => {
      await asRole('app_rw', A);
      expect(await count('match_candidates')).toBe(1);
      expect(await count('event_observations')).toBe(1);
    });

    it('switching tenant context changes the visible set', async () => {
      await asRole('app_rw', A);
      expect(await count('event_observations')).toBe(1);
      await asRole('app_rw', B);
      expect(await count('event_observations')).toBe(1);
      const r = await c.query<{ document_id: string }>('SELECT document_id FROM event_observations');
      expect(r.rows[0].document_id).toBe('d2222222-0000-0000-0000-000000000001');
    });

    it("hides another tenant's observation even when addressed by transaction_id", async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM event_observations WHERE transaction_id = 'e2222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it("hides another tenant's candidate even when addressed by id", async () => {
      await asRole('app_rw', A);
      const r = await c.query(
        `SELECT 1 FROM match_candidates WHERE id = 'ca222222-0000-0000-0000-000000000001'`,
      );
      expect(r.rowCount).toBe(0);
    });

    it('rejects a write into another tenant — event_observations', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO event_observations (id, tenant_id, transaction_id, kind, statement_line_id)
         VALUES (gen_random_uuid(), $1, 'e2222222-0000-0000-0000-000000000001', 'statement_line',
                 (SELECT id FROM statement_lines WHERE tenant_id = current_tenant_id()))`,
        [B],
      );
      await c.query('RESET ROLE');
      const r = await c.query(
        `SELECT 1 FROM event_observations WHERE transaction_id = 'e2222222-0000-0000-0000-000000000001' AND kind = 'statement_line'`,
      );
      expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
    });

    it('rejects a write into another tenant — match_candidates', async () => {
      await asRole('app_rw', A);
      await expectRejected(
        `INSERT INTO match_candidates (id, tenant_id, statement_line_id, document_id, proposed_by)
         VALUES (gen_random_uuid(), $1, (SELECT id FROM statement_lines WHERE tenant_id = current_tenant_id()),
                 'd2222222-0000-0000-0000-000000000001', 'user')`,
        [B],
      );
      await c.query('RESET ROLE');
      const r = await c.query(
        `SELECT 1 FROM match_candidates WHERE document_id = 'd2222222-0000-0000-0000-000000000001' AND proposed_by = 'user'`,
      );
      expect(r.rowCount, 'nothing may leak across the boundary').toBe(0);
    });

    it('fails closed with no tenant context', async () => {
      await asRole('app_rw', null);
      expect(await count('match_candidates')).toBe(0);
      expect(await count('event_observations')).toBe(0);
    });

    it('grants the worker NO bypass here — an ordinary tenant table, unlike jobs', async () => {
      await asRole('app_worker', null);
      expect(await count('event_observations')).toBe(0);
      await asRole('app_worker', B);
      expect(await count('event_observations')).toBe(1);
    });
  });

  it('lets app_readonly read but not write', async () => {
    await asRole('app_readonly', A);
    expect(await count('documents')).toBe(1);
    await expectRejected(
      `INSERT INTO categories (id, tenant_id, name) VALUES (gen_random_uuid(), $1, 'Nope')`,
      [A],
    );
  });
});
