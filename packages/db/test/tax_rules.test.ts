import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ID_2026 } from '@snap/tax-rules';

/**
 * TAX PACKS (migration 0026) — the checked duplication.
 *
 * `tax_codes` seeds the Indonesian rows in SQL and `ID_2026.taxCodes` declares
 * the same rows in TypeScript. That duplication is deliberate: the database
 * must be self-contained and RLS-readable without loading a TypeScript module,
 * and the rule set must be usable on a device with no database.
 *
 * But two copies of one fact is the exact shape this repository has been bitten
 * by — *nothing checks the agreement between two correct things*. Six defects
 * once passed their own tests while being broken in what actually ran, and the
 * drift test next door exists for the same reason.
 *
 * So the duplication is CHECKED. If either side moves alone, this fails.
 *
 * Requires DATABASE_URL. `pnpm db:up && pnpm db:migrate` provides one.
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

type Row = {
  country: string;
  code: string;
  name: string;
  rate: string;
  purchase_labels: string[];
  sale_labels: string[];
  claims_credit: boolean;
};

describeIfDb('tax rules (0026)', () => {
  let pool: Pool;
  let idRows: Row[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const { rows } = await pool.query<Row>(
      `SELECT country, code, name, rate, purchase_labels, sale_labels, claims_credit
         FROM tax_codes
        WHERE tenant_id IS NULL AND country = 'ID'
        ORDER BY code`,
    );
    idRows = rows;
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe('the seeded rows and the rules agree', () => {
    it('seeds exactly the codes the rules declares', () => {
      expect(idRows.map((r) => r.code).sort()).toEqual(
        ID_2026.taxCodes.map((c) => c.code).sort(),
      );
    });

    it.each(ID_2026.taxCodes.map((c) => [c.code, c] as const))(
      '%s matches the rules on name, rate, labels and credit',
      (code, packCode) => {
        const row = idRows.find((r) => r.code === code);
        expect(row, `tax_codes has no ID row for ${code}`).toBeDefined();
        expect(row!.name).toBe(packCode.name);
        expect(Number(row!.rate)).toBe(packCode.ratePercent);
        expect(row!.purchase_labels).toEqual(packCode.purchaseLabels);
        expect(row!.sale_labels).toEqual(packCode.saleLabels);
        expect(row!.claims_credit).toBe(packCode.claimsCredit);
      },
    );

    it('claims no credit on any Indonesian code', () => {
      // A personal Indonesian taxpayer is not a PKP, so input PPN is not
      // recoverable — and PPN on a retail docket is not recoverable even by a
      // PKP. docs/INDONESIA.md §4.3. One true row here would turn a spending
      // analytic into a claim.
      expect(idRows.every((r) => r.claims_credit === false)).toBe(true);
    });

    it('carries no report labels, because a personal taxpayer files no PPN return', () => {
      // SPT Masa PPN is a PKP filing. Labels would imply a return that does
      // not exist for this taxpayer.
      expect(idRows.every((r) => r.purchase_labels.length === 0)).toBe(true);
      expect(idRows.every((r) => r.sale_labels.length === 0)).toBe(true);
    });
  });

  describe('jurisdictions do not collide', () => {
    it('keeps the Australian codes on AU', async () => {
      const { rows } = await pool.query<{ code: string }>(
        `SELECT code FROM tax_codes WHERE tenant_id IS NULL AND country = 'AU' ORDER BY code`,
      );
      // The seven codes 0005 seeded, untouched by the backfill.
      expect(rows.map((r) => r.code)).toEqual([
        'CAP',
        'EXP',
        'FRE',
        'GST',
        'GSTONINCOME',
        'INP',
        'N-T',
      ]);
    });

    it("lets 'N-T' exist in both countries, which the old constraint could not express", async () => {
      // The collision that surfaced the latent bug: 'N-T' is a legitimate code
      // in both code sets, and the pre-0026 UNIQUE (tenant_id, code) treated
      // NULL tenant_ids as DISTINCT — so it silently permitted duplicates of
      // precisely the rows it was meant to protect.
      const { rows } = await pool.query<{ country: string }>(
        `SELECT country FROM tax_codes WHERE tenant_id IS NULL AND code = 'N-T' ORDER BY country`,
      );
      expect(rows.map((r) => r.country)).toEqual(['AU', 'ID']);
    });

    it('now REFUSES a true duplicate, which it previously allowed', async () => {
      // The refusal, not the permission. Before 0026 this insert succeeded.
      await expect(
        pool.query(
          `INSERT INTO tax_codes (id, tenant_id, country, code, name, rate, purchase_labels, sale_labels, claims_credit)
           VALUES (gen_random_uuid(), NULL, 'ID', 'PPN', 'Duplicate', 11.0000, '{}', '{}', false)`,
        ),
      ).rejects.toThrow(/tax_codes_tenant_country_code_key/);
    });
  });

  describe('tenants carry their installed engine', () => {
    it('defaults to no engine rather than to Australia', async () => {
      // No default on purpose. A fallback to 'au-2026' would reintroduce the
      // silent-wrong-law failure the whole rule set registry exists to refuse.
      const { rows } = await pool.query<{ column_default: string | null }>(
        `SELECT column_default FROM information_schema.columns
          WHERE table_name = 'tenants' AND column_name = 'tax_rules_id'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.column_default).toBeNull();
    });

    it('refuses a rules id without its version', async () => {
      // Half a fact is not replayable: a figure stamped 'id-2026' with no
      // version cannot be re-derived once the rates move.
      const id = crypto.randomUUID();
      await expect(
        pool.query(
          `INSERT INTO tenants (id, name, kind, country, base_currency, tax_rules_id)
           VALUES ($1, 'Warung Test', 'personal', 'ID', 'IDR', 'id-2026')`,
          [id],
        ),
      ).rejects.toThrow(/tenants_tax_rules_complete/);
    });

    it('accepts a rules id with its version', async () => {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO tenants (id, name, kind, country, base_currency, financial_year_start_month, tax_rules_id, tax_rules_version)
         VALUES ($1, 'Warung Test', 'personal', 'ID', 'IDR', 1, 'id-2026', $2)`,
        [id, ID_2026.version],
      );
      const { rows } = await pool.query<{ tax_rules_id: string; tax_rules_version: string }>(
        `SELECT tax_rules_id, tax_rules_version FROM tenants WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.tax_rules_id).toBe('id-2026');
      expect(rows[0]!.tax_rules_version).toBe(ID_2026.version);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    });
  });

  describe('a split cannot carry another country\'s tax code', () => {
    it('refuses an Australian GST code on an Indonesian workspace', async () => {
      // Without the trigger this posts cleanly and produces a BAS line for a
      // taxpayer who has never heard of a BAS.
      const tenantId = crypto.randomUUID();
      const accountId = crypto.randomUUID();
      const txnId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO tenants (id, name, kind, country, base_currency, financial_year_start_month, tax_rules_id, tax_rules_version)
         VALUES ($1, 'Warung Trigger', 'personal', 'ID', 'IDR', 1, 'id-2026', $2)`,
        [tenantId, ID_2026.version],
      );
      await pool.query(
        `INSERT INTO accounts (id, tenant_id, code, name, account_type)
         VALUES ($1, $2, '6-1200', 'Belanja', 'expense')`,
        [accountId, tenantId],
      );
      await pool.query(
        `INSERT INTO transactions (id, tenant_id, txn_date, status, source)
         VALUES ($1, $2, '2026-06-01', 'draft', 'manual')`,
        [txnId, tenantId],
      );

      const { rows: au } = await pool.query<{ id: string }>(
        `SELECT id FROM tax_codes WHERE tenant_id IS NULL AND country = 'AU' AND code = 'GST'`,
      );
      const { rows: id } = await pool.query<{ id: string }>(
        `SELECT id FROM tax_codes WHERE tenant_id IS NULL AND country = 'ID' AND code = 'PPN'`,
      );

      await expect(
        pool.query(
          `INSERT INTO transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id)
           VALUES (gen_random_uuid(), $1, $2, 1, $3, 110000, $4)`,
          [tenantId, txnId, accountId, au[0]!.id],
        ),
      ).rejects.toThrow(/belongs to AU but this workspace is in ID/);

      // And the Indonesian code on the same workspace is accepted, so the
      // trigger is refusing the mismatch rather than refusing everything.
      await pool.query(
        `INSERT INTO transaction_splits (id, tenant_id, transaction_id, line_number, account_id, amount, tax_code_id)
         VALUES (gen_random_uuid(), $1, $2, 1, $3, 110000, $4)`,
        [tenantId, txnId, accountId, id[0]!.id],
      );

      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    });
  });
});
