import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * WHERE A RECEIPT WAS BOUGHT, ON THE RECEIPT — migration 0061 (plan task 9.5.i).
 *
 *   - the migration applied: the four `documents.merchant_*` columns exist and
 *     start NULL for every existing row;
 *   - the CHECKs refuse what the application's normaliser would have dropped
 *     (a bad state, a bad postcode, a lone state or street, over-long text) and
 *     accept every valid shape, including a postcode straddling a border;
 *   - tenant isolation still holds on the new columns: as `app_rw`, a workspace
 *     reads its own receipts' locations and not another's, cannot write into
 *     another's, and fails closed with no workspace set; `app_readonly` reads
 *     but cannot write them.
 *
 * Runs as the owner for fixtures and as the real application roles for the RLS
 * assertions (a superuser bypasses RLS and would pass vacuously).
 */

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('receipt merchant location (migration 0061)', () => {
  let c: Client;
  const A = randomUUID();
  const B = randomUUID();
  const docA = randomUUID();
  const docB = randomUUID();
  const captureA = randomUUID();
  const captureB = randomUUID();

  const COLUMNS = ['merchant_line1', 'merchant_city', 'merchant_state', 'merchant_postcode'];

  async function asRole(role: string, tenantId: string | null) {
    await c.query('RESET ROLE');
    await c.query(`SET ROLE ${role}`);
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId ?? '']);
  }
  async function asOwner() {
    await c.query('RESET ROLE');
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
  }

  /** A fresh capture+document in tenant A, as the owner, with the given merchant columns. */
  async function insertDoc(m: Partial<Record<string, string | null>>): Promise<void> {
    const capture = randomUUID();
    await c.query(
      `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
       VALUES ($1, $2, 'k', 'image/jpeg', 10, digest($3::text, 'sha256'))`,
      [capture, A, `merchant-${capture}`],
    );
    await c.query(
      `INSERT INTO documents (id, tenant_id, capture_id, merchant_line1, merchant_city, merchant_state, merchant_postcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), A, capture, m.line1 ?? null, m.city ?? null, m.state ?? null, m.postcode ?? null],
    );
  }

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    await c.connect();
    await c.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Merchant loc A'), ($2, 'Merchant loc B')`, [A, B]);
    await c.query(
      `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256) VALUES
        ($1, $3, 'ka', 'image/jpeg', 100, digest($5::text, 'sha256')),
        ($2, $4, 'kb', 'image/jpeg', 100, digest($6::text, 'sha256'))`,
      [captureA, captureB, A, B, `ml-a-${A}`, `ml-b-${B}`],
    );
    // Two branches of the same chain, one per workspace here; the per-receipt
    // point is proven end to end in apps/server (merchant-location.e2e.test.ts).
    await c.query(
      `INSERT INTO documents (id, tenant_id, capture_id, merchant_line1, merchant_city, merchant_state, merchant_postcode) VALUES
        ($1, $3, $5, '245 Parramatta Rd', 'Haymarket', 'NSW', '2000'),
        ($2, $4, $6, NULL, 'Chermside', 'QLD', '4032')`,
      [docA, docB, A, B, captureA, captureB],
    );
  });

  afterAll(async () => {
    await asOwner();
    await c.query('DELETE FROM documents WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM captures WHERE tenant_id = ANY($1::uuid[])', [[A, B]]);
    await c.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[A, B]]);
    await c.end();
  });

  it('adds four nullable text columns to documents', async () => {
    const r = await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'documents' AND column_name = ANY($1::text[]) ORDER BY column_name`,
      [COLUMNS],
    );
    expect(r.rows.map((x) => x.column_name)).toEqual([...COLUMNS].sort());
    for (const col of r.rows) {
      expect(col.data_type, col.column_name).toBe('text');
      expect(col.is_nullable, col.column_name).toBe('YES');
    }
  });

  it('a receipt with no location stores NULL in all four', async () => {
    await asOwner();
    const capture = randomUUID();
    await c.query(
      `INSERT INTO captures (id, tenant_id, original_storage_key, original_mime_type, original_byte_size, original_sha256)
       VALUES ($1, $2, 'k', 'image/jpeg', 10, digest($3::text, 'sha256'))`,
      [capture, A, `none-${capture}`],
    );
    const id = randomUUID();
    await c.query(`INSERT INTO documents (id, tenant_id, capture_id) VALUES ($1, $2, $3)`, [id, A, capture]);
    const r = await c.query(
      `SELECT merchant_line1, merchant_city, merchant_state, merchant_postcode FROM documents WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ merchant_line1: null, merchant_city: null, merchant_state: null, merchant_postcode: null });
  });

  describe('the CHECKs match the normaliser', () => {
    it('accepts every state code, every issued postcode range, and a suburb alone or a postcode alone', async () => {
      await asOwner();
      const good: Array<Record<string, string | null>> = [
        { city: 'Haymarket', state: 'NSW', postcode: '2000' },
        { city: 'Fitzroy', state: 'VIC', postcode: '3065' },
        { city: 'Chermside', state: 'QLD', postcode: '4032' },
        { city: 'Fremantle', state: 'WA', postcode: '6160' },
        { city: 'Adelaide', state: 'SA', postcode: '5000' },
        { city: 'Hobart', state: 'TAS', postcode: '7000' },
        { city: 'Canberra', state: 'ACT', postcode: '2601' },
        { city: 'Darwin', state: 'NT', postcode: '0800' },
        { city: 'Alice Springs', state: 'NT', postcode: '0872' }, // straddles NT, SA and WA
        { city: 'Barton', state: 'ACT', postcode: '0221' },
        { line1: 'Shop 3/12 Pitt St', city: 'Bondi Junction', state: null, postcode: null },
        { line1: null, city: null, state: null, postcode: '3000' },
        { line1: '1 High St', city: null, state: null, postcode: '9999' },
      ];
      for (const g of good) await insertDoc(g);
    });

    it('refuses a state that is not one of the eight codes', async () => {
      await asOwner();
      for (const state of ['New South Wales', 'nsw', 'NZ', 'XX', '']) {
        await expect(insertDoc({ city: 'Newtown', state }), `state ${JSON.stringify(state)}`).rejects.toThrow(
          /documents_merchant_state_check/,
        );
      }
    });

    it('refuses a postcode that is not four digits inside an Australian range', async () => {
      await asOwner();
      for (const postcode of ['20000', '200', '2O00', '2 000', 'ABCD', '0000', '0150', '0300', '0799', '-200', '2000.0', '']) {
        await expect(insertDoc({ city: 'Newtown', postcode }), `postcode ${JSON.stringify(postcode)}`).rejects.toThrow(
          /documents_merchant_postcode_check/,
        );
      }
    });

    it('refuses a state or a street line with no suburb and no postcode beside it', async () => {
      await asOwner();
      await expect(insertDoc({ state: 'NSW' })).rejects.toThrow(/documents_merchant_placeable_check/);
      await expect(insertDoc({ line1: '12 High St' })).rejects.toThrow(/documents_merchant_placeable_check/);
      await expect(insertDoc({ line1: '12 High St', state: 'NSW' })).rejects.toThrow(
        /documents_merchant_placeable_check/,
      );
    });

    it('refuses text longer or shorter than the normaliser allows', async () => {
      await asOwner();
      await expect(insertDoc({ line1: 'x'.repeat(81), city: 'Newtown' })).rejects.toThrow(
        /documents_merchant_length_check/,
      );
      await expect(insertDoc({ line1: 'ab', city: 'Newtown' })).rejects.toThrow(/documents_merchant_length_check/);
      await expect(insertDoc({ city: 'N'.repeat(41) })).rejects.toThrow(/documents_merchant_length_check/);
      await expect(insertDoc({ city: 'N' })).rejects.toThrow(/documents_merchant_length_check/);
    });

    it('refuses an UPDATE that would break a rule, and keeps the old value', async () => {
      await asOwner();
      await expect(
        c.query(`UPDATE documents SET merchant_postcode = '99999' WHERE id = $1`, [docA]),
      ).rejects.toThrow(/documents_merchant_postcode_check/);
      const r = await c.query(`SELECT merchant_postcode FROM documents WHERE id = $1`, [docA]);
      expect(r.rows[0].merchant_postcode).toBe('2000');
    });
  });

  describe('row-level security still holds on the new columns', () => {
    it("a workspace reads its own receipts' locations and not another's", async () => {
      await asRole('app_rw', A);
      const own = await c.query(`SELECT id, merchant_city FROM documents WHERE id = ANY($1::uuid[])`, [[docA, docB]]);
      expect(own.rows).toEqual([{ id: docA, merchant_city: 'Haymarket' }]); // B's Chermside is invisible

      await asRole('app_rw', B);
      const other = await c.query(`SELECT id, merchant_city FROM documents WHERE id = ANY($1::uuid[])`, [[docA, docB]]);
      expect(other.rows).toEqual([{ id: docB, merchant_city: 'Chermside' }]);
    });

    it('cannot read or change another workspace location by primary key, and fails closed with no workspace', async () => {
      await asRole('app_rw', A);
      const byPk = await c.query(`SELECT merchant_city FROM documents WHERE id = $1`, [docB]);
      expect(byPk.rows).toHaveLength(0);
      const upd = await c.query(`UPDATE documents SET merchant_city = 'Hijacked' WHERE id = $1`, [docB]);
      expect(upd.rowCount).toBe(0);

      await asRole('app_rw', null);
      const none = await c.query(`SELECT merchant_city FROM documents WHERE id = ANY($1::uuid[])`, [[docA, docB]]);
      expect(none.rows).toHaveLength(0);

      await asOwner();
      const still = await c.query(`SELECT merchant_city FROM documents WHERE id = $1`, [docB]);
      expect(still.rows[0].merchant_city).toBe('Chermside');
    });

    it("app_rw may write its own workspace's location and not a foreign one into its own row's tenant", async () => {
      await asRole('app_rw', A);
      const ok = await c.query(`UPDATE documents SET merchant_city = 'Ultimo' WHERE id = $1`, [docA]);
      expect(ok.rowCount).toBe(1);
      // Moving the row to another workspace is refused by the WITH CHECK.
      await expect(c.query(`UPDATE documents SET tenant_id = $1 WHERE id = $2`, [B, docA])).rejects.toThrow();
      await asOwner();
      await c.query(`UPDATE documents SET merchant_city = 'Haymarket' WHERE id = $1`, [docA]);
    });

    it('app_readonly reads the location in its workspace and cannot write it', async () => {
      await asRole('app_readonly', A);
      const r = await c.query(`SELECT merchant_state, merchant_postcode FROM documents WHERE id = ANY($1::uuid[])`, [
        [docA, docB],
      ]);
      expect(r.rows).toEqual([{ merchant_state: 'NSW', merchant_postcode: '2000' }]);
      await expect(c.query(`UPDATE documents SET merchant_city = 'X1' WHERE id = $1`, [docA])).rejects.toThrow();
    });
  });
});
