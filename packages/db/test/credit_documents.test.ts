import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * RECEIPTS AND TAX INVOICES FOR CREDIT PURCHASES — migration 0059
 * (group tasks 7.7.a, 7.7.b, 6.12.b).
 *
 * Against a real Postgres, as the application role. Fixtures are written as
 * the owner before any `SET ROLE`; every assertion about grants, RLS and the
 * two-person rule runs as `app_rw`, because a superuser bypasses RLS and makes
 * every isolation assertion pass vacuously (the same reasoning as
 * `credits_points.test.ts`, which this file sits beside).
 *
 * This package's suites run one file at a time, and nothing else here issues
 * documents, so the numbering assertions can be exact against the counter.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

const TENANT_A = '7a000000-d0c5-4000-8000-000000000001';
const TENANT_B = '7a000000-d0c5-4000-8000-000000000002';
const BUYER = '7a000000-d0c5-4000-8000-000000000003';
const STAFF_1 = '7a000000-d0c5-4000-8000-000000000004';
const STAFF_2 = '7a000000-d0c5-4000-8000-000000000005';
const PLAIN = '7a000000-d0c5-4000-8000-000000000006';
const OTHER = '7a000000-d0c5-4000-8000-000000000007';
const TENANT_E = '7a000000-d0c5-4000-8000-000000000008'; // erased in its test

/** The ATO's example ABN. */
const ABN = '51824753556';

describeIfDb('credit documents and the invoice issuer (migration 0059)', () => {
  let c: Client;

  async function asAppRw(userId: string | null, tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query('SET ROLE app_rw');
    await c.query(`SELECT set_config('app.user_id', $1, false)`, [userId ?? '']);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }
  async function asOwner() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.tenant_id','',false)`);
    await c.query(`SELECT set_config('app.user_id','',false)`);
  }

  async function wipe() {
    await asOwner();
    // The test database is disposable: start from "no issuer approved".
    await c.query('DELETE FROM invoice_issuer_changes');
    await c.query(`DELETE FROM audit_log WHERE action LIKE 'invoice_issuer_%'`);
    // Documents survive their purchase and workspace (tax records), so remove them explicitly.
    await c.query(`DELETE FROM credit_documents WHERE tenant_id = ANY($1::uuid[]) OR buyer_name = 'Erased Workspace'`, [[TENANT_A, TENANT_B, TENANT_E]]);
    await c.query(`DELETE FROM jobs WHERE kind = 'storage_purge' AND payload->>'tenantId' = $1`, [TENANT_E]);
    await c.query('DELETE FROM credit_purchases WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B, TENANT_E]]);
    await c.query('DELETE FROM usage_grants WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B, TENANT_E]]);
    await c.query('DELETE FROM memberships WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B, TENANT_E]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[TENANT_A, TENANT_B, TENANT_E]]);
    const users = [BUYER, STAFF_1, STAFF_2, PLAIN, OTHER];
    await c.query(
      `DELETE FROM platform_staff_capabilities WHERE staff_id IN (SELECT id FROM platform_staff WHERE user_id = ANY($1::uuid[]))`,
      [users],
    );
    await c.query('DELETE FROM platform_staff WHERE user_id = ANY($1::uuid[])', [users]);
    await c.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  }

  /** An approved issuer, written as the owner (the propose/approve path has its own tests). */
  async function approveIssuer(opts: { abn: string | null; gst: boolean; name?: string; at: string }) {
    await asOwner();
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO invoice_issuer_changes
         (legal_name, abn, address, email, gst_registered, reason, status, proposed_by, decided_by, decided_at)
       VALUES ($1, $2, '1 George St, Sydney NSW 2000', 'billing@snap.test', $3, 'test', 'approved', $4, $5, $6)
       RETURNING id`,
      [opts.name ?? 'Snap Apps Pty Ltd', opts.abn, opts.gst, STAFF_1, STAFF_2, opts.at],
    );
    return rows[0]!.id;
  }

  async function paidPurchase(tenantId: string, opts: { provider?: string; price?: string } = {}) {
    await asOwner();
    const grant = randomUUID();
    const id = randomUUID();
    await c.query(
      `INSERT INTO usage_grants (id, tenant_id, metric, amount, remaining, source) VALUES ($1,$2,'scans',100,100,'topup_pack')`,
      [grant, tenantId],
    );
    await c.query(
      `INSERT INTO credit_purchases (id, tenant_id, purchased_by, pack_code, credits, price_aud, status, provider, grant_id, paid_at)
       VALUES ($1,$2,$3,'credits_100',100,$4,'paid',$5,$6, now())`,
      [id, tenantId, BUYER, opts.price ?? '5.0000', opts.provider ?? 'stripe', grant],
    );
    return id;
  }

  async function markRefunded(purchaseId: string) {
    await asOwner();
    await c.query(`UPDATE credit_purchases SET status = 'refunded' WHERE id = $1`, [purchaseId]);
  }

  async function issue(tenantId: string, purchaseId: string, direction: 'sale' | 'refund') {
    await asAppRw(BUYER, tenantId);
    const { rows } = await c.query<{ n: string | null }>(`SELECT credit_document_issue($1, $2) AS n`, [purchaseId, direction]);
    await asOwner();
    return rows[0]!.n === null ? null : Number(rows[0]!.n);
  }

  async function documentOf(purchaseId: string, direction: 'sale' | 'refund') {
    await asOwner();
    const { rows } = await c.query(
      `SELECT number::int AS number, kind, total_cents::int AS total_cents, gst_cents::int AS gst_cents, issuer,
              original_number::int AS original_number, buyer_name, buyer_email
         FROM credit_documents WHERE purchase_id = $1 AND direction = $2`,
      [purchaseId, direction],
    );
    return rows[0] as
      | { number: number; kind: string; total_cents: number; gst_cents: number | null; issuer: Record<string, unknown> | null; original_number: number | null; buyer_name: string; buyer_email: string | null }
      | undefined;
  }

  async function counter(): Promise<number> {
    await asOwner();
    const { rows } = await c.query<{ n: string }>('SELECT last_number::text AS n FROM credit_document_counter');
    return Number(rows[0]!.n);
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await wipe();
    await c.query(
      `INSERT INTO tenants (id, name, kind, country, base_currency)
       VALUES ($1,'Buyer Workspace','business','AU','AUD'), ($2,'Other Workspace','business','AU','AUD'),
              ($3,'Erased Workspace','business','AU','AUD')`,
      [TENANT_A, TENANT_B, TENANT_E],
    );
    await c.query(
      `INSERT INTO users (id, subject, email, display_name) VALUES
         ($1,'idp|doc-buyer','buyer@docs.test','Buyer'),
         ($2,'idp|doc-staff1','staff1@docs.test','Staff One'),
         ($3,'idp|doc-staff2','staff2@docs.test','Staff Two'),
         ($4,'idp|doc-plain','plain@docs.test','Plain'),
         ($5,'idp|doc-other','other@docs.test','Other')`,
      [BUYER, STAFF_1, STAFF_2, PLAIN, OTHER],
    );
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$3,'owner'), ($2,$4,'owner')`,
      [TENANT_A, TENANT_B, BUYER, OTHER],
    );
    for (const u of [STAFF_1, STAFF_2]) {
      await c.query(`INSERT INTO platform_staff (user_id, role) VALUES ($1,'billing')`, [u]);
      await c.query(
        `INSERT INTO platform_staff_capabilities (staff_id, capability)
           SELECT id, cap::platform_capability FROM platform_staff, unnest(ARRAY['manage_platform_settings','manage_billing']) cap
            WHERE user_id = $1`,
        [u],
      );
    }
  });

  afterAll(async () => {
    await wipe();
    await c.end();
  });

  describe('the ABN check digits in SQL', () => {
    it("accepts the ATO's example and rejects every one-digit change", async () => {
      await asOwner();
      const ok = await c.query<{ v: boolean }>('SELECT abn_is_valid($1) AS v', [ABN]);
      expect(ok.rows[0]!.v).toBe(true);
      for (let i = 0; i < ABN.length; i += 1) {
        const changed = ABN.slice(0, i) + String((Number(ABN[i]) + 1) % 10) + ABN.slice(i + 1);
        const r = await c.query<{ v: boolean }>('SELECT abn_is_valid($1) AS v', [changed]);
        expect(r.rows[0]!.v, changed).toBe(false);
      }
    });
  });

  describe('the issuer: propose, then a second admin approves', () => {
    async function propose(userId: string, over: Partial<{ abn: string | null; gst: boolean }> = {}) {
      await asAppRw(userId, null);
      const abn = 'abn' in over ? over.abn : ABN;
      const { rows } = await c.query<{ id: string }>(
        `SELECT admin_invoice_issuer_propose('Snap Apps Pty Ltd', $1, '1 George St, Sydney NSW 2000', 'billing@snap.test', $2, 'Company set up') AS id`,
        [abn, over.gst ?? true],
      );
      return rows[0]!.id;
    }

    it('a user who is not staff is refused (42501)', async () => {
      await expect(propose(PLAIN)).rejects.toMatchObject({ code: '42501' });
      await asAppRw(PLAIN, null);
      await expect(c.query('SELECT * FROM admin_invoice_issuer_list()')).rejects.toMatchObject({ code: '42501' });
    });

    it('refuses an ABN that fails the check digits, and GST registered without an ABN (23514)', async () => {
      await expect(propose(STAFF_1, { abn: '51824753557' })).rejects.toMatchObject({ code: '23514' });
      await expect(propose(STAFF_1, { abn: null, gst: true })).rejects.toMatchObject({ code: '23514' });
    });

    it('the proposer cannot approve their own change; a second admin can; the trail is kept', async () => {
      const id = await propose(STAFF_1);

      await asAppRw(STAFF_1, null);
      await expect(c.query('SELECT admin_invoice_issuer_decide($1, true)', [id])).rejects.toMatchObject({ code: '42501' });

      // One pending change at a time.
      await expect(propose(STAFF_2)).rejects.toMatchObject({ code: '23514' });

      await asAppRw(PLAIN, null);
      await expect(c.query('SELECT admin_invoice_issuer_decide($1, true)', [id])).rejects.toMatchObject({ code: '42501' });

      await asAppRw(STAFF_2, null);
      await c.query('SELECT admin_invoice_issuer_decide($1, true)', [id]);
      const list = await c.query<{ id: string; status: string; decided_by: string }>('SELECT id, status, decided_by FROM admin_invoice_issuer_list()');
      expect(list.rows.find((r) => r.id === id)).toMatchObject({ status: 'approved', decided_by: STAFF_2 });

      // Decided is final.
      await expect(c.query('SELECT admin_invoice_issuer_decide($1, false)', [id])).rejects.toMatchObject({ code: '23514' });

      await asOwner();
      const audit = await c.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['invoice_issuer_proposed', 'invoice_issuer_approved']);
    });

    it('the proposer may reject (withdraw) their own change', async () => {
      const id = await propose(STAFF_1);
      await asAppRw(STAFF_1, null);
      await c.query('SELECT admin_invoice_issuer_decide($1, false)', [id]);
      await asOwner();
      const r = await c.query<{ status: string }>('SELECT status FROM invoice_issuer_changes WHERE id = $1', [id]);
      expect(r.rows[0]!.status).toBe('rejected');
    });

    it('the table itself refuses a self-approval, an edit of a decided row, and any grant to app_rw', async () => {
      await asOwner();
      await expect(
        c.query(
          `INSERT INTO invoice_issuer_changes (legal_name, abn, address, email, gst_registered, reason, status, proposed_by, decided_by, decided_at)
           VALUES ('X', NULL, 'a', 'x@x.test', false, 'r', 'approved', $1, $1, now())`,
          [STAFF_1],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      const approved = await c.query<{ id: string }>(`SELECT id FROM invoice_issuer_changes WHERE status = 'approved' LIMIT 1`);
      await expect(
        c.query(`UPDATE invoice_issuer_changes SET legal_name = 'Changed' WHERE id = $1`, [approved.rows[0]!.id]),
      ).rejects.toMatchObject({ code: '23000' });

      await asAppRw(STAFF_1, null);
      await expect(c.query('SELECT * FROM invoice_issuer_changes')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('SELECT * FROM credit_document_counter')).rejects.toMatchObject({ code: '42501' });
      await asOwner();
    });
  });

  describe('one document per purchase, tax invoice or receipt', () => {
    it('with no issuer approved: a Receipt, no GST, no issuer', async () => {
      await asOwner();
      await c.query('DELETE FROM invoice_issuer_changes');
      const purchase = await paidPurchase(TENANT_A);
      const n = await issue(TENANT_A, purchase, 'sale');
      const doc = await documentOf(purchase, 'sale');
      expect(doc).toMatchObject({ number: n, kind: 'receipt', total_cents: 500, gst_cents: null, issuer: null });
      expect(doc!.buyer_name).toBe('Buyer Workspace');
      expect(doc!.buyer_email).toBe('buyer@docs.test');
    });

    it('with a valid ABN but not GST registered: still a Receipt', async () => {
      await approveIssuer({ abn: ABN, gst: false, at: '2026-01-01T00:00:00Z' });
      const purchase = await paidPurchase(TENANT_A);
      await issue(TENANT_A, purchase, 'sale');
      expect(await documentOf(purchase, 'sale')).toMatchObject({ kind: 'receipt', gst_cents: null });
    });

    it('with a valid ABN and GST registered: a Tax invoice, A$5.00 includes A$0.45, issuer snapshotted', async () => {
      await approveIssuer({ abn: ABN, gst: true, at: '2026-02-01T00:00:00Z' });
      const purchase = await paidPurchase(TENANT_A);
      await issue(TENANT_A, purchase, 'sale');
      const doc = await documentOf(purchase, 'sale');
      expect(doc).toMatchObject({ kind: 'tax_invoice', total_cents: 500, gst_cents: 45 });
      expect(doc!.issuer).toMatchObject({ legalName: 'Snap Apps Pty Ltd', abn: ABN, gstRegistered: true });
    });

    it('is idempotent: issuing again returns the same document and adds no row', async () => {
      const purchase = await paidPurchase(TENANT_A);
      const first = await issue(TENANT_A, purchase, 'sale');
      const before = await counter();
      const second = await issue(TENANT_A, purchase, 'sale');
      const third = await issue(TENANT_A, purchase, 'sale');
      expect([second, third]).toEqual([first, first]);
      expect(await counter()).toBe(before);
      const { rows } = await c.query('SELECT count(*)::int AS n FROM credit_documents WHERE purchase_id = $1', [purchase]);
      expect(rows[0].n).toBe(1);
    });

    it('a later issuer change never rewrites an issued document', async () => {
      const purchase = await paidPurchase(TENANT_A);
      await issue(TENANT_A, purchase, 'sale');
      const before = await documentOf(purchase, 'sale');
      await approveIssuer({ abn: ABN, gst: true, name: 'Renamed Pty Ltd', at: '2026-03-01T00:00:00Z' });
      expect(await documentOf(purchase, 'sale')).toEqual(before);
      // ...while the next purchase carries the new one.
      const next = await paidPurchase(TENANT_A);
      await issue(TENANT_A, next, 'sale');
      expect((await documentOf(next, 'sale'))!.issuer).toMatchObject({ legalName: 'Renamed Pty Ltd' });
    });

    it('a Google Play or Apple purchase gets no document', async () => {
      for (const provider of ['google', 'apple']) {
        const purchase = await paidPurchase(TENANT_A, { provider });
        expect(await issue(TENANT_A, purchase, 'sale')).toBeNull();
        expect(await documentOf(purchase, 'sale')).toBeUndefined();
      }
    });

    it('refuses to issue for a purchase that is not paid, or another workspace', async () => {
      const purchase = await paidPurchase(TENANT_A);
      await expect(issue(TENANT_A, purchase, 'refund')).rejects.toMatchObject({ code: '23514' });
      await asAppRw(OTHER, TENANT_B);
      await expect(c.query('SELECT credit_document_issue($1, $2)', [purchase, 'sale'])).rejects.toMatchObject({ code: 'P0002' });
      await asOwner();
    });
  });

  describe('refunds', () => {
    it('a refund of a tax invoice is an Adjustment note: negative amount and GST, naming the original', async () => {
      await approveIssuer({ abn: ABN, gst: true, name: 'Snap Apps Pty Ltd', at: '2026-04-01T00:00:00Z' });
      const purchase = await paidPurchase(TENANT_A);
      const sale = await issue(TENANT_A, purchase, 'sale');
      await markRefunded(purchase);
      // Even if the settings flip to "not GST registered" before the refund.
      await approveIssuer({ abn: null, gst: false, at: '2026-04-02T00:00:00Z' });
      const refund = await issue(TENANT_A, purchase, 'refund');
      expect(refund).toBeGreaterThan(sale!);
      expect(await documentOf(purchase, 'refund')).toMatchObject({
        kind: 'adjustment_note', total_cents: -500, gst_cents: -45, original_number: sale,
      });
      expect((await documentOf(purchase, 'refund'))!.issuer).toMatchObject({ abn: ABN });
    });

    it('a refund of a receipt is a Refund receipt with no GST; a second refund issues nothing new', async () => {
      await approveIssuer({ abn: null, gst: false, at: '2026-05-01T00:00:00Z' });
      const purchase = await paidPurchase(TENANT_A);
      const sale = await issue(TENANT_A, purchase, 'sale');
      await markRefunded(purchase);
      const refund = await issue(TENANT_A, purchase, 'refund');
      expect(await documentOf(purchase, 'refund')).toMatchObject({
        kind: 'refund_receipt', total_cents: -500, gst_cents: null, original_number: sale,
      });
      expect(await issue(TENANT_A, purchase, 'refund')).toBe(refund);
    });
  });

  describe('gap-free numbering', () => {
    it('concurrent purchases get distinct consecutive numbers, and a rolled-back one gives its number back', async () => {
      await approveIssuer({ abn: ABN, gst: true, at: '2026-06-01T00:00:00Z' });
      const purchases: string[] = [];
      for (let i = 0; i < 8; i += 1) purchases.push(await paidPurchase(TENANT_A));
      const start = await counter();

      const attempt = async (purchaseId: string, commit: boolean): Promise<number | null> => {
        const client = new Client({ connectionString: url });
        await client.connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL ROLE app_rw');
          await client.query(`SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`, [BUYER, TENANT_A]);
          const { rows } = await client.query<{ n: string }>(`SELECT credit_document_issue($1, 'sale') AS n`, [purchaseId]);
          await client.query(commit ? 'COMMIT' : 'ROLLBACK');
          return commit ? Number(rows[0]!.n) : null;
        } finally {
          await client.end();
        }
      };

      // Every third attempt rolls back.
      const results = await Promise.all(purchases.map((p, i) => attempt(p, i % 3 !== 2)));
      const committed = results.filter((n): n is number => n !== null).sort((a, b) => a - b);
      const expected = Array.from({ length: committed.length }, (_, i) => start + 1 + i);
      expect(committed).toEqual(expected);
      expect(await counter()).toBe(start + committed.length);

      // The rolled-back purchases have no document, so a retry takes the next number.
      const rolledBack = purchases.filter((_, i) => i % 3 === 2);
      for (const p of rolledBack) expect(await documentOf(p, 'sale')).toBeUndefined();
      const retry = await issue(TENANT_A, rolledBack[0]!, 'sale');
      expect(retry).toBe(start + committed.length + 1);
    });
  });

  describe('who can read and write documents', () => {
    it('a workspace reads its own documents only, and app_rw can write none', async () => {
      const purchase = await paidPurchase(TENANT_A);
      await issue(TENANT_A, purchase, 'sale');

      await asAppRw(BUYER, TENANT_A);
      const own = await c.query('SELECT id FROM credit_documents WHERE purchase_id = $1', [purchase]);
      expect(own.rows).toHaveLength(1);

      await asAppRw(OTHER, TENANT_B);
      const foreign = await c.query('SELECT id FROM credit_documents WHERE purchase_id = $1', [purchase]);
      expect(foreign.rows).toHaveLength(0);

      await asAppRw(BUYER, TENANT_A);
      await expect(
        c.query(
          `INSERT INTO credit_documents (tenant_id, purchase_id, direction, kind, number, pack_code, credits, total_cents, buyer_name, provider)
           VALUES ($1, $2, 'sale', 'receipt', 999999, 'credits_100', 100, 500, 'x', 'stripe')`,
          [TENANT_A, purchase],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(c.query(`UPDATE credit_documents SET total_cents = 1`)).rejects.toMatchObject({ code: '42501' });
      await expect(c.query(`DELETE FROM credit_documents`)).rejects.toMatchObject({ code: '42501' });
      await asOwner();
    });

    it('an issued document cannot be edited even by the owner, and a tax invoice needs an ABN on its issuer', async () => {
      const purchase = await paidPurchase(TENANT_A);
      await issue(TENANT_A, purchase, 'sale');
      await asOwner();
      await expect(
        c.query(`UPDATE credit_documents SET total_cents = 1 WHERE purchase_id = $1`, [purchase]),
      ).rejects.toMatchObject({ code: '23000' });
      await expect(
        c.query(
          `INSERT INTO credit_documents (tenant_id, purchase_id, direction, kind, number, pack_code, credits, total_cents, gst_cents, buyer_name, provider)
           VALUES ($1, $2, 'refund', 'adjustment_note', 888888, 'credits_100', 100, -500, -45, 'x', 'stripe')`,
          [TENANT_A, purchase],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('only app_rw may call the issuing function', async () => {
      const purchase = await paidPurchase(TENANT_A);
      await asOwner();
      await c.query('SET ROLE app_readonly');
      await expect(c.query(`SELECT credit_document_issue($1, 'sale')`, [purchase])).rejects.toMatchObject({ code: '42501' });
      await asOwner();
    });
  });

  describe('erasing a workspace keeps its tax documents', () => {
    it('detaches them (tenant and purchase NULL), readable by no tenant, and the GST report still counts them', async () => {
      await approveIssuer({ abn: ABN, gst: true, at: '2026-07-01T00:00:00Z' });
      const purchase = await paidPurchase(TENANT_E);
      const number = (await issue(TENANT_E, purchase, 'sale'))!;

      const report = async () => {
        await asAppRw(STAFF_1, null);
        const r = await c.query<{ number: string; total_cents: string; gst_cents: string; kind: string }>(
          `SELECT number::text, total_cents::text, gst_cents::text, kind FROM admin_gst_report(current_date - 1, current_date + 1) WHERE section = 'documents' ORDER BY number`,
        );
        await asOwner();
        return r.rows;
      };
      const before = await report();
      expect(before.find((r) => Number(r.number) === number)).toMatchObject({ kind: 'tax_invoice', total_cents: '500', gst_cents: '45' });

      await asOwner();
      await c.query('SELECT erase_workspace($1)', [TENANT_E]);

      const kept = await c.query(
        `SELECT tenant_id, purchase_id, kind, total_cents::int AS total, gst_cents::int AS gst, issuer->>'abn' AS abn, buyer_name FROM credit_documents WHERE number = $1`,
        [number],
      );
      expect(kept.rows).toEqual([
        { tenant_id: null, purchase_id: null, kind: 'tax_invoice', total: 500, gst: 45, abn: ABN, buyer_name: 'Erased Workspace' },
      ]);
      expect(await report()).toEqual(before);

      // No tenant can read it, whatever tenant it is acting as.
      for (const [user, tenant] of [[BUYER, TENANT_A], [OTHER, TENANT_B]] as const) {
        await asAppRw(user, tenant);
        const r = await c.query('SELECT 1 FROM credit_documents WHERE number = $1', [number]);
        expect(r.rows).toHaveLength(0);
      }
      await asAppRw(null, null);
      expect((await c.query('SELECT 1 FROM credit_documents WHERE number = $1', [number])).rows).toHaveLength(0);
      await asOwner();
    });
  });

  describe('the GST report query', () => {
    it('is for billing staff only, takes a sane range, and lists Play sales apart', async () => {
      const stripe = await paidPurchase(TENANT_A);
      await issue(TENANT_A, stripe, 'sale');
      const play = await paidPurchase(TENANT_A, { provider: 'google', price: '1.8500' });

      await asAppRw(PLAIN, null);
      await expect(c.query(`SELECT * FROM admin_gst_report(current_date - 1, current_date + 1)`)).rejects.toMatchObject({ code: '42501' });

      await asAppRw(STAFF_1, null);
      await expect(c.query(`SELECT * FROM admin_gst_report(current_date, current_date - 1)`)).rejects.toMatchObject({ code: '23514' });
      const { rows } = await c.query<{ section: string; ref: string | null; total_cents: string; kind: string }>(
        `SELECT section, ref, total_cents::text, kind FROM admin_gst_report(current_date - 1, current_date + 1)`,
      );
      expect(rows.some((r) => r.section === 'documents' && r.kind === 'tax_invoice')).toBe(true);
      expect(rows.find((r) => r.section === 'google' && r.ref === play)).toMatchObject({ total_cents: '185', kind: 'play_sale' });
      // A Play purchase never appears as one of our documents.
      expect(rows.filter((r) => r.section === 'documents' && r.ref !== null)).toHaveLength(0);
      await asOwner();
    });
  });
});
