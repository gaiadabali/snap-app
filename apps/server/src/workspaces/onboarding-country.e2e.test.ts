import { randomBytes, randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AU_2026, ID_2026, familyOf, rulesForDate } from '@snap/tax-rules';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MailMessage } from '../auth/mailer.js';
import { BUILTIN } from '../taxrules/tax-name.js';
import { todayIso } from '../taxrules/taxrules.repo.js';
import { makeAccount, wipeTenant } from '../test-support/tenant.js';

/** The Australian year covering today: what the catalogue and settings show. */
const AU_NOW = rulesForDate(familyOf(BUILTIN, 'au-2026'), todayIso()).rules;

/**
 * AN AUSTRALIAN SIGNS UP BY EMAIL — through real HTTP, against a real database.
 *
 * Build plan 1.38. Until `au-2026` existed the catalogue held Indonesia only,
 * so the phone's registration picker could not offer Australia and an
 * Australian could get in only through YourTal. This walks the whole email
 * path the way a person does: ask for a sign-in link, open it, see Australia in
 * the country list, finish onboarding with it, and land in a workspace that is
 * Australian in every column that matters and works downstream.
 *
 * Indonesia is walked the same way after it, unchanged. Refusals sit with the
 * cases they guard.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('onboarding by email, by country — real HTTP, real database', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let sent: MailMessage[] = [];
  let restoreMailer: () => void;
  let settleMail: () => Promise<void>;
  const emails: string[] = [];
  const tenants: string[] = [];

  const run = randomBytes(4).toString('hex');
  let ip = 0;
  const freshIp = () => `2001:db8:${run.slice(0, 4)}:${run.slice(4)}::${(++ip).toString(16)}`;

  const call = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    opts: { token?: string; workspaceId?: string; body?: unknown } = {},
  ) =>
    app.inject({
      method,
      url: path,
      remoteAddress: freshIp(),
      ...(opts.body === undefined ? {} : { payload: opts.body as Record<string, unknown> }),
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.workspaceId ? { 'x-workspace-id': opts.workspaceId } : {}),
      },
    });

  /** Ask for a link, take it from the mail, and open it — the whole email sign-up. */
  async function signUpByEmail(tag: string): Promise<{ token: string; userId: string }> {
    const email = `onboard-${tag}-${Date.now()}-${randomBytes(3).toString('hex')}@example.test`;
    emails.push(email);

    const asked = await call('POST', '/v1/auth/magic-link/request', { body: { email } });
    expect(asked.statusCode).toBe(200);
    await settleMail();

    const mail = [...sent].reverse().find((m) => m.to === email);
    expect(mail, `no sign-in mail to ${email}`).toBeDefined();
    expect(mail!.subject).toBe('Sign in to SnapApp');
    const linkToken = decodeURIComponent(mail!.text.match(/token=([^\s&]+)/)![1]!);

    const opened = await call('POST', '/v1/auth/magic-link/consume', { body: { token: linkToken } });
    expect(opened.statusCode).toBe(200);
    const body = opened.json() as { token: string; user: { userId: string }; workspaces: unknown[] };
    // A brand-new account has nowhere to put a receipt yet: onboarding comes next.
    expect(body.workspaces).toEqual([]);
    return { token: body.token, userId: body.user.userId };
  }

  async function onboard(token: string, body: Record<string, unknown>) {
    // Finishing sign-up needs the GOD notice ticked (9.1.d); these tests are about the country.
    const res = await call('POST', '/v1/workspaces/onboarding', { token, body: { acceptedGodNotice: true, ...body } });
    if (res.statusCode === 200) tenants.push(res.json().workspaceId);
    return res;
  }

  const tenantRow = async (id: string) =>
    (
      await admin.query(
        `select country, base_currency, financial_year_start_month, tax_rules_id, tax_rules_version, kind
           from tenants where id = $1`,
        [id],
      )
    ).rows[0];

  /**
   * Onboarding writes more than any fixture does (categories, budgets, the
   * sign-up credits), so every table carrying this `tenant_id` is cleared —
   * a few passes, because foreign keys between them decide the order — and
   * then `wipeTenant` takes the rest and the tenant itself.
   */
  async function wipeOnboardedTenant(tenantId: string): Promise<void> {
    const { rows } = await admin.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'tenant_id'
          and table_name in (select table_name from information_schema.tables
                              where table_schema = 'public' and table_type = 'BASE TABLE')`,
    );
    for (let pass = 0; pass < 4; pass++) {
      for (const { table_name } of rows) {
        if (table_name === 'tax_codes') continue;
        await admin.query(`DELETE FROM "${table_name}" WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      }
    }
    await wipeTenant(admin, tenantId);
  }

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);
    process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();

    const mailer = await import('../auth/mailer.js');
    restoreMailer = mailer.setMailerForTesting({
      send: async (message) => {
        sent.push(message);
      },
    });
    settleMail = (await import('../auth/account-mail.js')).settleMailForTesting;

    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await settleMail?.();
    restoreMailer?.();
    for (const id of tenants) await wipeOnboardedTenant(id);
    if (emails.length) await admin.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await admin.end();
    await app?.close();
  });

  it('offers Australia and Indonesia before anyone is signed in', async () => {
    const res = await call('GET', '/v1/tax-rules-catalogue');
    expect(res.statusCode).toBe(200);
    const catalogue = res.json() as { rulesId: string; country: string; currency: string; consumptionTaxName: string }[];
    // One Australia — the year covering today (au-2026 until 30 June 2027) —
    // never one entry per year held.
    expect(catalogue.map((r) => r.rulesId)).toEqual([AU_NOW.id, 'id-2026']);
    expect(catalogue[0]).toMatchObject({ country: 'AU', currency: 'AUD', consumptionTaxName: 'GST' });
  });

  describe('an Australian', () => {
    let token: string;
    let workspaceId: string;

    beforeAll(async () => {
      ({ token } = await signUpByEmail('au'));
    });

    it('is refused a country this deployment does not have, and nothing is created', async () => {
      const res = await onboard(token, { workspaceName: 'Nowhere', kind: 'personal', taxRulesId: 'nz-2026' });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain(`Australia (${AU_NOW.id})`);
      const session = await call('GET', '/v1/auth/session', { token });
      expect(session.json().workspaces).toEqual([]);
    });

    it('picks Australia, and the workspace is AU, AUD, July and au-2026', async () => {
      const res = await onboard(token, {
        workspaceName: 'Our household',
        kind: 'personal',
        taxRulesId: 'au-2026',
        monthlyBudget: '2500',
      });
      expect(res.statusCode).toBe(200);
      workspaceId = res.json().workspaceId;

      expect(await tenantRow(workspaceId)).toEqual({
        country: 'AU',
        base_currency: 'AUD',
        financial_year_start_month: 7,
        tax_rules_id: 'au-2026',
        tax_rules_version: AU_2026.version,
        kind: 'personal',
      });
    });

    it('names the workspace tax GST in AUD on the workspace list', async () => {
      const res = await call('GET', '/v1/workspaces', { token });
      const mine = res.json().find((w: { id: string }) => w.id === workspaceId);
      expect(mine).toMatchObject({ baseCurrency: 'AUD', taxName: 'GST' });
    });

    it('reports the installed engine as Australia — not "no engine installed"', async () => {
      const res = await call('GET', '/v1/tax-rules', { token, workspaceId });
      expect(res.statusCode).toBe(200);
      // The year covering today, whichever year was installed.
      expect(res.json()).toMatchObject({
        rulesId: AU_NOW.id,
        rulesVersion: AU_NOW.version,
        countryName: 'Australia',
        taxYear: AU_NOW.taxYear,
        consumptionTaxName: 'GST',
        currency: 'AUD',
        annualReturnName: 'Individual tax return',
        filingPeriod: 'none',
        recoverable: false,
        problem: null,
      });
    });

    it('keeps the budget it gave at sign-up', async () => {
      const res = await call('GET', '/v1/personal', { token, workspaceId });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json())).toContain('2500');
    });

    it('has the deduction year for Free Tax Returns, and cents-per-km mileage', async () => {
      const year = await call('GET', '/v1/deduction-bundle/year', { token, workspaceId });
      expect(year.statusCode).toBe(200);
      expect(year.json().financialYear).toMatch(/^\d{4}-\d{2}$/);

      const mileage = await call('GET', '/v1/mileage', { token, workspaceId });
      expect(mileage.statusCode).toBe(200);
      expect(mileage.json().centsPerKmRate).toBeGreaterThan(0);
    });

    it('reports GST paid in exact cents, with GST-free spend apart from it', async () => {
      const expense = await makeAccount(admin, workspaceId, '6-1200', 'Groceries', 'expense');
      const bank = await makeAccount(admin, workspaceId, '1-1100', 'Bank', 'asset');
      const gstAsset = await makeAccount(admin, workspaceId, '1-1300', 'GST paid', 'asset');
      const code = async (c: string) =>
        (
          await admin.query(`select id from tax_codes where tenant_id is null and country = 'AU' and code = $1`, [c])
        ).rows[0].id as string;
      const gst = await code('GST');
      const fre = await code('FRE');

      const post = async (lines: { account: string; amount: string; taxCode?: string; gst?: string }[]) => {
        const txnId = randomUUID();
        await admin.query('begin');
        await admin.query(
          `insert into transactions (id, tenant_id, txn_date, status, source, posted_at)
           values ($1, $2, '2026-08-15', 'posted', 'manual', now())`,
          [txnId, workspaceId],
        );
        let n = 1;
        for (const l of lines) {
          await admin.query(
            `insert into transaction_splits
               (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id, gst_amount)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [randomUUID(), workspaceId, txnId, n++, l.account, l.amount, l.taxCode ?? null, l.gst ?? '0'],
          );
        }
        await admin.query('commit');
      };

      // $33.33 of taxable groceries (GST $3.03 — 33.33/11 = 3.03), and $20.10
      // of fresh fruit, GST-free. Cents that a float sum would smear.
      await post([
        { account: expense, amount: '30.30', taxCode: gst, gst: '3.03' },
        { account: gstAsset, amount: '3.03' },
        { account: bank, amount: '-33.33' },
      ]);
      await post([
        { account: expense, amount: '20.10', taxCode: fre, gst: '0' },
        { account: bank, amount: '-20.10' },
      ]);

      const res = await call('GET', '/v1/tax-rules/consumption-tax?from=2026-07-01&to=2027-06-30', {
        token,
        workspaceId,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        rulesId: 'au-2026',
        taxName: 'GST',
        currency: 'AUD',
        grossSpend: '53.43',
        taxPaid: '3.03',
        exemptSpend: '20.10',
        otherTaxPaid: '0.00',
        recoverable: false,
        filingPeriod: 'none',
      });
      expect(body.disclosure).toMatch(/^GST you paid/);
      const byCode = Object.fromEntries(body.lines.map((l: { code: string; treatment: string }) => [l.code, l.treatment]));
      expect(byCode).toEqual({ GST: 'standard', FRE: 'exempt' });
    });
  });

  it('an Australian business keeps the BAS engine, with no personal rule set on it', async () => {
    const { token } = await signUpByEmail('au-biz');
    const res = await onboard(token, { workspaceName: 'Acme Trades', kind: 'business', taxRulesId: 'au-2026' });
    expect(res.statusCode).toBe(200);
    expect(await tenantRow(res.json().workspaceId)).toMatchObject({
      country: 'AU',
      base_currency: 'AUD',
      financial_year_start_month: 7,
      tax_rules_id: null,
      tax_rules_version: null,
    });
  });

  it('an Indonesian signs up exactly as before: ID, IDR, January and id-2026', async () => {
    const { token } = await signUpByEmail('id');
    const res = await onboard(token, { workspaceName: 'Rumah kami', kind: 'personal', taxRulesId: 'id-2026' });
    expect(res.statusCode).toBe(200);
    expect(await tenantRow(res.json().workspaceId)).toEqual({
      country: 'ID',
      base_currency: 'IDR',
      financial_year_start_month: 1,
      tax_rules_id: 'id-2026',
      tax_rules_version: ID_2026.version,
      kind: 'personal',
    });
  });

  it('a sign-up that names no country gets the old Australian defaults and no rule set', async () => {
    const { token } = await signUpByEmail('none');
    const res = await onboard(token, { workspaceName: 'No country', kind: 'personal' });
    expect(res.statusCode).toBe(200);
    expect(await tenantRow(res.json().workspaceId)).toMatchObject({
      country: 'AU',
      base_currency: 'AUD',
      tax_rules_id: null,
    });
  });
});
