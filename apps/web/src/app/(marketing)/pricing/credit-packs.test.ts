/**
 * The website must advertise the price the checkout will actually charge.
 *
 * Two places hold the pack prices: `credit_packs`, seeded by migration 0027,
 * which is what a customer is charged; and `credit-packs.ts`, which is what
 * the pricing page says. Both derive from the same rule — model cost × 3 — but
 * "both derive from the same rule" is a thing that is true until someone edits
 * one of them.
 *
 * A marketing page quoting a price the checkout does not honour is a
 * misleading representation under Australian Consumer Law s18, so this reads
 * the migration and compares. It is the same class of bug as the "Placeholder
 * link" line that sat under a working download: copy that was true when
 * written and made false by a change somewhere else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CREDIT_PACKS, CREDIT_PRICE_AUD, MODEL_COST_AUD, PRICE_MULTIPLE } from './credit-packs';

const MIGRATION = join(
  __dirname,
  '../../../../../../packages/db/migrations/0027_credit_repricing.sql',
);

/** `UPDATE credit_packs SET price_aud = 3.3000 WHERE code = 'credits_100';` */
function pricesFromMigration(): Map<number, number> {
  const sql = readFileSync(MIGRATION, 'utf8');
  const rows = new Map<number, number>();
  const re = /price_aud\s*=\s*([\d.]+)\s+WHERE\s+code\s*=\s*'credits_(\d+)'/gi;
  for (const m of sql.matchAll(re)) {
    rows.set(Number(m[2]), Number(m[1]));
  }
  return rows;
}

describe('credit pack pricing', () => {
  it('derives one credit from the owner’s rule: model cost × 3', () => {
    expect(MODEL_COST_AUD).toBe(0.011);
    expect(PRICE_MULTIPLE).toBe(3);
    expect(CREDIT_PRICE_AUD).toBeCloseTo(0.033, 6);
  });

  it('advertises exactly what migration 0027 charges', () => {
    const charged = pricesFromMigration();

    // A parse that silently matched nothing would make this pass forever.
    expect(charged.size).toBe(6);

    for (const pack of CREDIT_PACKS) {
      const dbPrice = charged.get(pack.credits);
      expect(dbPrice, `no credits_${pack.credits} row in 0027`).toBeDefined();
      expect(
        Number(pack.priceAud),
        `the site says $${pack.priceAud} for ${pack.credits} credits, the database charges $${dbPrice}`,
      ).toBeCloseTo(dbPrice as number, 4);
    }
  });

  it('sells the six bundles the owner named', () => {
    expect(CREDIT_PACKS.map((p) => p.credits)).toEqual([10, 50, 100, 200, 500, 1000]);
  });

  it('prints money as a decimal string with two places, never a float', () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.priceAud).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
