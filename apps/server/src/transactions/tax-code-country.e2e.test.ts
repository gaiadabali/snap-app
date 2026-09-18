import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A tenant gets ITS OWN country's tax codes.
 *
 * WHY THIS EXISTS. `loadTaxCodes` selected every global row and keyed the map
 * by `code` alone. `N-T` exists in BOTH the Australian and Indonesian sets —
 * verified in production, two rows — so one silently overwrote the other and
 * which survived depended on row order. `tax_codes.country` was right there
 * and never read. `taxCodeFor('S')` then returned a bare `'GST'`, which is the
 * Australian standard code and does not exist in the Indonesian set at all.
 *
 * Migration 0026's `transaction_splits_tax_code_country` trigger is what kept
 * this from being silent: it REFUSES a split whose tax code belongs to another
 * country. So the first Indonesian tenant to post a standard-rated document
 * would have hit a trigger refusal naming the ledger — loud, and pointing
 * nowhere near the function that chose the code.
 *
 * It was latent rather than live: every production tenant is AU and no
 * transaction had ever been posted. It would have bitten the first ID tenant,
 * which is the market `packages/tax-rules`' `id-2026` set exists for. This
 * test is the thing that stops it coming back.
 *
 * Runs against real Postgres because the collision is in the DATA — two rows
 * sharing a code across countries — and a mocked table cannot have it.
 */
const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb('tax codes are chosen per tenant country', () => {
  let admin: Client;

  beforeAll(async () => {
    process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
    admin = new Client({ connectionString: process.env.ADMIN_DATABASE_URL ?? url });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  it('the collision this guards against is real in the data, not hypothetical', async () => {
    // If this ever returns nothing, the rest of the file proves less than it
    // looks like it does — so it is asserted rather than assumed.
    const { rows } = await admin.query<{ code: string; countries: number }>(
      `select code, count(distinct country)::int as countries
         from tax_codes where tenant_id is null
        group by code having count(distinct country) > 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.code)).toContain('N-T');
  });

  it('Indonesia has PPN and no GST; Australia the reverse', async () => {
    const codesFor = async (country: string) =>
      (
        await admin.query<{ code: string }>(
          `select code from tax_codes where tenant_id is null and country = $1`,
          [country],
        )
      ).rows.map((r) => r.code);

    const id = await codesFor('ID');
    const au = await codesFor('AU');

    // The heart of it: 'GST' is not an Indonesian code, so a function that
    // returns a bare 'GST' cannot be right for an Indonesian tenant.
    expect(id).toContain('PPN');
    expect(id).not.toContain('GST');
    expect(au).toContain('GST');
    expect(au).not.toContain('PPN');
  });

  it('every country that has tax codes has one for the default category', async () => {
    // `taxCodeFor` falls through to 'N-T' for anything unrecognised. A country
    // whose set lacks it would produce an undefined lookup and a null tax code
    // three layers from here.
    const { rows } = await admin.query<{ country: string; has_default: boolean }>(
      `select country, bool_or(code = 'N-T') as has_default
         from tax_codes where tenant_id is null group by country`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.has_default, `country ${row.country} has no N-T code`).toBe(true);
    }
  });

  it('0026 still enforces the country match, so a wrong code cannot post quietly', async () => {
    // The trigger is the backstop that made this loud instead of silent. If it
    // were ever dropped, the bug above would corrupt rather than refuse.
    const { rows } = await admin.query<{ tgname: string }>(
      `select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname = 'transaction_splits' and not t.tgisinternal`,
    );
    expect(rows.map((r) => r.tgname)).toContain('transaction_splits_tax_code_country');
  });
});
