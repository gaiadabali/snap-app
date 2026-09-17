import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ID_2026 } from '@snap/tax-rules';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeAccount, provisionTenant, wipeTenant } from '../test-support/tenant.js';

/**
 * THE TAX ENGINE, THROUGH REAL HTTP.
 *
 * `packages/tax-rules` has 78 unit tests and they prove the arithmetic. They
 * cannot prove that the controller is wired into `AppModule`, that the guards
 * are applied, that the SQL matches the schema, or that a refusal survives the
 * trip through Nest as a status code rather than a 500.
 *
 * This repository's own rule: *run the thing — the composition is where the
 * defect lives.* The README records six defects that passed their own tests
 * while being broken in what actually ran, including "every capability-gated
 * admin route with a 500 while its e2e suite passed 6/6, happy path included."
 *
 * So the refusals are first, and the happy path is last.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('tax rules — real HTTP', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: typeof import('../tokens.js').issueSession;

  const TENANT = 'cccccccc-0000-4000-8000-000000000001';
  const USER = 'cccccccc-0000-4000-8000-000000000002';

  // MembershipGuard takes the workspace from `X-Workspace-Id` and verifies the
  // caller's membership of it — a bearer token alone is deliberately not enough.
  const auth = () => ({
    authorization: `Bearer ${issueSession(USER)}`,
    'x-workspace-id': TENANT,
  });

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Warung Sederhana',
      users: [{ id: USER, role: 'owner' }],
    });

    // The fixture creates an Australian workspace. Make it Indonesian and
    // personal — an ABN on an Indonesian household is nonsense, and the
    // database refuses `gst_registered` on a personal workspace.
    await admin.query(
      `update tenants set country = 'ID', base_currency = 'IDR', kind = 'personal',
              abn = NULL, gst_registered = false, financial_year_start_month = 1
         where id = $1`,
      [TENANT],
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
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
    await app.close();
  });

  /* ── Refusals first ──────────────────────────────────────────────────── */

  it('refuses both routes with no Authorization header — 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/tax-rules' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/tax-rules/consumption-tax?from=2026-01-01&to=2026-12-31',
        })
      ).statusCode,
    ).toBe(401);
  });

  it('reports "no engine installed" as a STATE, not a crash', async () => {
    // A settings screen has to render this and offer the list to install
    // from, so it is a 200 carrying a problem — not a 500.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rulesId).toBeNull();
    expect(body.problem).toMatch(/no tax rules are installed/i);
    expect(body.available.map((a: { rulesId: string }) => a.rulesId)).toContain('id-2026');
  });

  it('refuses a tax figure while no engine is installed — 422, never zeros', async () => {
    // The worst possible answer here is a confident nothing: zeros are
    // indistinguishable from a workspace that genuinely spent nothing.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules/consumption-tax?from=2026-01-01&to=2026-12-31',
      headers: auth(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/no tax rules are installed/i);
  });

  it('refuses a malformed rules id — 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/tax-rules',
      headers: auth(),
      payload: { rulesId: 'Indonesia' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a well-formed id for a rule set that does not exist — 422', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/tax-rules',
      headers: auth(),
      payload: { rulesId: 'zz-2026' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('refuses a bad date range — 400', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules/consumption-tax?from=2026-12-31&to=2026-01-01',
      headers: auth(),
    });
    expect(bad.statusCode).toBe(400);
  });

  /* ── Installing ──────────────────────────────────────────────────────── */

  it('installs the engine and moves country, currency and financial year WITH it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/tax-rules',
      headers: auth(),
      payload: { rulesId: 'id-2026' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rulesId).toBe('id-2026');
    expect(body.rulesVersion).toBe(ID_2026.version);
    expect(body.consumptionTaxName).toBe('PPN');
    expect(body.problem).toBeNull();

    // A personal Indonesian taxpayer files no SPT Masa PPN and cannot recover
    // input PPN. Both must reach the client, or a screen will imply otherwise.
    expect(body.filingPeriod).toBe('none');
    expect(body.recoverable).toBe(false);
    expect(body.annualReturnName).toMatch(/SPT Tahunan/);

    // The settings that would otherwise disagree with the engine.
    const { rows } = await admin.query(
      `select country, base_currency, financial_year_start_month, tax_rules_id, tax_rules_version
         from tenants where id = $1`,
      [TENANT],
    );
    expect(rows[0].country).toBe('ID');
    expect(rows[0].base_currency).toBe('IDR');
    expect(rows[0].financial_year_start_month).toBe(1);
    expect(rows[0].tax_rules_version).toBe(ID_2026.version);
  });

  /* ── The analytic ────────────────────────────────────────────────────── */

  it('reports PPN paid, keeps PB1 out of it, and says it is not a claim', async () => {
    const expense = await makeAccount(admin, TENANT, '6-1200', 'Belanja', 'expense');
    const bank = await makeAccount(admin, TENANT, '1-1100', 'Kas', 'asset');
    const gstControl = await makeAccount(admin, TENANT, '1-1300', 'PPN dibayar', 'asset');

    const codeId = async (code: string) => {
      const { rows } = await admin.query(
        `select id from tax_codes where tenant_id is null and country = 'ID' and code = $1`,
        [code],
      );
      return rows[0].id as string;
    };
    const ppn = await codeId('PPN');
    const pb1 = await codeId('PB1');
    const bebas = await codeId('PPN-BEBAS');

    /**
     * Three purchases, each balanced, each posted:
     *
     *   1. Rp 1,000,000 net + Rp 110,000 PPN   -> standard
     *   2. Rp   200,000 net + Rp  20,000 PB1   -> a DIFFERENT tax
     *   3. Rp    50,000 exempt (beras)         -> PP 49/2022, no tax
     */
    const post = async (
      lines: { account: string; amount: number; taxCode?: string; gst?: number }[],
    ) => {
      const txnId = randomUUID();
      // ONE transaction around the whole entry. `assert_transaction_balanced`
      // (0006) is DEFERRABLE INITIALLY DEFERRED, so it fires at COMMIT — and
      // with pg's autocommit each insert would be its own commit, tripping the
      // balance check on the first split before the others exist.
      await admin.query('begin');
      await admin.query(
        // `posted_at` is required by `txn_posted_has_timestamp` (0006): a
        // posted entry must record when it was posted.
        `insert into transactions (id, tenant_id, txn_date, status, source, posted_at)
         values ($1, $2, '2026-06-15', 'posted', 'manual', now())`,
        [txnId, TENANT],
      );
      let n = 1;
      for (const l of lines) {
        await admin.query(
          `insert into transaction_splits
             (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), TENANT, txnId, n++, l.account, l.amount, l.taxCode ?? null, l.gst ?? 0],
        );
      }
      await admin.query('commit');
    };

    await post([
      { account: expense, amount: 1_000_000, taxCode: ppn, gst: 110_000 },
      { account: gstControl, amount: 110_000 },
      { account: bank, amount: -1_110_000 },
    ]);
    await post([
      { account: expense, amount: 200_000, taxCode: pb1, gst: 20_000 },
      { account: gstControl, amount: 20_000 },
      { account: bank, amount: -220_000 },
    ]);
    await post([
      { account: expense, amount: 50_000, taxCode: bebas, gst: 0 },
      { account: bank, amount: -50_000 },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules/consumption-tax?from=2026-01-01&to=2026-12-31',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(Number(body.grossSpend)).toBe(1_380_000); // 1,110,000 + 220,000 + 50,000
    // PPN only. PB1 is a regional tax that prints like PPN and is never
    // recoverable — folding it in would overstate this by Rp 20,000.
    expect(Number(body.taxPaid)).toBe(110_000);
    expect(Number(body.otherTaxPaid)).toBe(20_000);
    expect(Number(body.exemptSpend)).toBe(50_000);

    expect(body.recoverable).toBe(false);
    expect(body.filingPeriod).toBe('none');
    expect(body.disclosure).toMatch(/not a claim/);
    expect(body.disclosure).toMatch(/cannot be recovered/);

    // Replayability: the figure names the law it was computed under.
    expect(body.rulesId).toBe('id-2026');
    expect(body.rulesVersion).toBe(ID_2026.version);

    const byCode = Object.fromEntries(
      body.lines.map((l: { code: string; treatment: string }) => [l.code, l.treatment]),
    );
    expect(byCode).toEqual({ PPN: 'standard', PB1: 'other_tax', 'PPN-BEBAS': 'exempt' });
  });

  it('excludes drafts, because a draft is not spending that happened', async () => {
    const expense = await makeAccount(admin, TENANT, '6-1900', 'Draf', 'expense');
    const bank = await makeAccount(admin, TENANT, '1-1900', 'Kas draf', 'asset');
    const { rows } = await admin.query(
      `select id from tax_codes where tenant_id is null and country = 'ID' and code = 'PPN'`,
    );
    const txnId = randomUUID();
    await admin.query(
      `insert into transactions (id, tenant_id, txn_date, status, source)
       values ($1, $2, '2026-06-20', 'draft', 'manual')`,
      [txnId, TENANT],
    );
    await admin.query(
      `insert into transaction_splits
         (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount)
       values ($1, $2, $3, 1, $4, 9000000, $5, 990000)`,
      [randomUUID(), TENANT, txnId, expense, rows[0].id],
    );
    await admin.query(
      `insert into transaction_splits
         (id, tenant_id, transaction_id, line_number, account_id, amount, gst_amount)
       values ($1, $2, $3, 2, $4, -9990000, 0)`,
      [randomUUID(), TENANT, txnId, bank],
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/tax-rules/consumption-tax?from=2026-01-01&to=2026-12-31',
      headers: auth(),
    });
    // Unchanged by a nine-million-rupiah draft sitting in the ledger.
    expect(Number(res.json().taxPaid)).toBe(110_000);
  });
});
