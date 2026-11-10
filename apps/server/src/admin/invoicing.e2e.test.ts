import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Group task 7.7.a and 6.12.b through real HTTP, as admin.e2e.test.ts does:
 * the issuer is PROPOSED by one admin and APPROVED by a different one; a
 * non-admin is refused (403); the ABN is checked with the ATO check digits; and
 * the GST export is for billing staff only.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const ADMIN_A = 'bbbbbbbb-0000-4000-8000-0000000007a1';
const ADMIN_B = 'bbbbbbbb-0000-4000-8000-0000000007a2';
const SETTINGS_ONLY = 'bbbbbbbb-0000-4000-8000-0000000007a3';
const PLAIN_USER = 'bbbbbbbb-0000-4000-8000-0000000007a4';
const ALL = [ADMIN_A, ADMIN_B, SETTINGS_ONLY, PLAIN_USER];

const ABN = '51 824 753 556';
const BODY = {
  legalName: 'Snap Apps Pty Ltd',
  abn: ABN,
  address: '1 George St\nSydney NSW 2000',
  email: 'billing@snap.test',
  gstRegistered: true,
  reason: 'Company registered',
};

describeIfDb('invoice issuer and GST report — real HTTP', () => {
  let app: NestFastifyApplication;
  let admin: Client;
  let issueSession: (userId: string) => string;

  const auth = (userId: string) => ({ authorization: `Bearer ${issueSession(userId)}` });
  const get = (userId: string, path: string) => app.inject({ method: 'GET', url: path, headers: auth(userId) });
  const post = (userId: string, path: string, payload?: unknown) =>
    app.inject({ method: 'POST', url: path, headers: auth(userId), payload: payload as object | undefined });

  async function cleanup() {
    await admin.query('DELETE FROM invoice_issuer_changes');
    await admin.query(`DELETE FROM audit_log WHERE action LIKE 'invoice_issuer_%'`);
    await admin.query(
      `DELETE FROM platform_staff_capabilities WHERE staff_id IN (SELECT id FROM platform_staff WHERE user_id = ANY($1))`,
      [ALL],
    );
    await admin.query('DELETE FROM platform_staff WHERE user_id = ANY($1)', [ALL]);
    await admin.query('DELETE FROM users WHERE id = ANY($1)', [ALL]);
  }

  async function makeStaff(userId: string, capabilities: string[]) {
    await admin.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1, 'billing')`, [userId]);
    for (const capability of capabilities) {
      await admin.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability)
           SELECT id, $2::platform_capability FROM platform_staff WHERE user_id = $1`,
        [userId, capability],
      );
    }
  }

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    process.env.ADMIN_KMS_MASTER_KEY ??= '11'.repeat(32);

    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
    await cleanup();
    await admin.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1, 'dev|inv-a', 'inv-a@admin.test', 'Admin A'),
         ($2, 'dev|inv-b', 'inv-b@admin.test', 'Admin B'),
         ($3, 'dev|inv-s', 'inv-s@admin.test', 'Settings Only'),
         ($4, 'dev|inv-p', 'inv-p@admin.test', 'Plain')`,
      ALL,
    );
    await makeStaff(ADMIN_A, ['manage_platform_settings', 'manage_billing']);
    await makeStaff(ADMIN_B, ['manage_platform_settings', 'manage_billing']);
    await makeStaff(SETTINGS_ONLY, ['manage_platform_settings']);

    issueSession = await (await import('../test-support/sessions.js')).openSessions(...ALL);
    const { AppModule } = await import('../app.module.js');
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await app.close();
  });

  it('refuses no session (401) and a signed-in non-admin (403) on every invoicing route', async () => {
    for (const path of ['/v1/admin/invoicing/issuer', '/v1/admin/invoicing/gst-report?quarter=FY2026-Q2']) {
      expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
      expect((await get(PLAIN_USER, path)).statusCode).toBe(403);
    }
    expect((await post(PLAIN_USER, '/v1/admin/invoicing/issuer/proposals', BODY)).statusCode).toBe(403);
    expect((await post(PLAIN_USER, '/v1/admin/invoicing/issuer/proposals/bbbbbbbb-0000-4000-8000-0000000000ff/approve')).statusCode).toBe(403);
  });

  it('starts with no issuer: receipts, nothing pending', async () => {
    const res = await get(ADMIN_A, '/v1/admin/invoicing/issuer');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ current: null, pending: null, history: [], mode: 'receipt' });
  });

  it('refuses a bad ABN and GST registered without one (400), a bad email, and a missing reason', async () => {
    const p = '/v1/admin/invoicing/issuer/proposals';
    expect((await post(ADMIN_A, p, { ...BODY, abn: '51 824 753 557' })).statusCode).toBe(400);
    expect((await post(ADMIN_A, p, { ...BODY, abn: null, gstRegistered: true })).statusCode).toBe(400);
    expect((await post(ADMIN_A, p, { ...BODY, email: 'not-an-email' })).statusCode).toBe(400);
    expect((await post(ADMIN_A, p, { ...BODY, reason: '' })).statusCode).toBe(400);
    const state = (await get(ADMIN_A, '/v1/admin/invoicing/issuer')).json();
    expect(state.pending).toBeNull();
  });

  it('the proposer cannot approve; a second admin can; the change then takes effect', async () => {
    const proposed = await post(ADMIN_A, '/v1/admin/invoicing/issuer/proposals', BODY);
    expect(proposed.statusCode).toBe(200);
    const pending = proposed.json().pending;
    expect(pending).toMatchObject({ legalName: 'Snap Apps Pty Ltd', abn: '51824753556', gstRegistered: true, status: 'pending' });
    expect(proposed.json().mode).toBe('receipt'); // nothing changes until approved

    // Not their own.
    expect((await post(ADMIN_A, `/v1/admin/invoicing/issuer/proposals/${pending.id}/approve`)).statusCode).toBe(403);
    // Not while one is waiting.
    expect((await post(ADMIN_B, '/v1/admin/invoicing/issuer/proposals', BODY)).statusCode).toBe(400);
    // Still pending.
    expect((await get(ADMIN_B, '/v1/admin/invoicing/issuer')).json()).toMatchObject({ current: null, mode: 'receipt' });

    const approved = await post(ADMIN_B, `/v1/admin/invoicing/issuer/proposals/${pending.id}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      pending: null,
      mode: 'tax_invoice',
      current: { id: pending.id, status: 'approved', abn: '51824753556' },
    });
    expect(approved.json().current.decidedByLabel).toBe('Admin B');

    // Decided is final.
    expect((await post(ADMIN_B, `/v1/admin/invoicing/issuer/proposals/${pending.id}/reject`)).statusCode).toBe(400);
    // An unknown or malformed id is a 404.
    expect((await post(ADMIN_B, '/v1/admin/invoicing/issuer/proposals/not-a-uuid/approve')).statusCode).toBe(404);

    const trail = await admin.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM audit_log WHERE entity_id = $1 ORDER BY id`,
      [pending.id],
    );
    expect(trail.rows).toEqual([
      { action: 'invoice_issuer_proposed', actor_id: ADMIN_A },
      { action: 'invoice_issuer_approved', actor_id: ADMIN_B },
    ]);
  });

  it('switching to not GST registered is again a proposal, and flips the mode back to receipts once approved', async () => {
    const proposed = await post(ADMIN_B, '/v1/admin/invoicing/issuer/proposals', { ...BODY, gstRegistered: false, reason: 'Deregistered' });
    expect(proposed.statusCode).toBe(200);
    // The proposer may withdraw.
    const id = proposed.json().pending.id;
    expect((await post(ADMIN_B, `/v1/admin/invoicing/issuer/proposals/${id}/reject`)).statusCode).toBe(200);
    expect((await get(ADMIN_A, '/v1/admin/invoicing/issuer')).json()).toMatchObject({ pending: null, mode: 'tax_invoice' });

    const again = await post(ADMIN_B, '/v1/admin/invoicing/issuer/proposals', { ...BODY, gstRegistered: false, reason: 'Deregistered' });
    const state = await post(ADMIN_A, `/v1/admin/invoicing/issuer/proposals/${again.json().pending.id}/approve`);
    expect(state.json().mode).toBe('receipt');
    expect(state.json().history.length).toBeGreaterThanOrEqual(3);
  });

  it('the GST report needs the billing capability, takes a quarter or a range, and names Google', async () => {
    // manage_platform_settings alone is not enough.
    expect((await get(SETTINGS_ONLY, '/v1/admin/invoicing/gst-report?quarter=FY2026-Q2')).statusCode).toBe(403);

    const res = await get(ADMIN_A, '/v1/admin/invoicing/gst-report?quarter=FY2026-Q2');
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report).toMatchObject({ from: '2025-10-01', to: '2025-12-31', filename: 'snap-gst-2025-10-01-to-2025-12-31.csv' });
    expect(report.csv).toContain('Document number,Date,Kind,Net,GST,Total,Refund refs');
    expect(report.csv).toContain('Google Play sales: GST paid by Google');
    expect(report.totals).toMatchObject({ salesCents: 0, refundsCents: 0, documentCount: 0 });

    expect((await get(ADMIN_A, '/v1/admin/invoicing/gst-report?from=2026-01-01&to=2026-03-31')).statusCode).toBe(200);
    for (const bad of ['', '?quarter=2026-Q2', '?from=2026-03-31&to=2026-01-01', '?from=2026-13-01&to=2026-14-01']) {
      expect((await get(ADMIN_A, `/v1/admin/invoicing/gst-report${bad}`)).statusCode, bad).toBe(400);
    }
  });
});
