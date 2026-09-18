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

import {
  CARD_FEE_RATE,
  CREDIT_PACKS,
  CREDIT_PRICE_AUD,
  GST_SHARE_OF_INCLUSIVE,
  MODEL_COST_AUD,
  PRICE_MULTIPLE,
  RETAINED_PER_CREDIT_AUD,
} from './credit-packs';

const MIGRATION = join(
  __dirname,
  '../../../../../../packages/db/migrations/0029_credit_all_in_pricing.sql',
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
  it('retains the owner’s multiple once GST and the card percentage come out', () => {
    expect(MODEL_COST_AUD).toBe(0.011);
    expect(PRICE_MULTIPLE).toBe(3);
    expect(RETAINED_PER_CREDIT_AUD).toBeCloseTo(0.033, 6);

    // The published rate is the retained figure grossed up for the two
    // PROPORTIONAL deductions. The fixed per-transaction fee is deliberately
    // not in here — see the note in credit-packs.ts.
    const grossedUp = RETAINED_PER_CREDIT_AUD / (1 - GST_SHARE_OF_INCLUSIVE - CARD_FEE_RATE);
    expect(CREDIT_PRICE_AUD).toBeCloseTo(grossedUp, 4);

    /*
     * What actually survives a sale, against what we meant to keep.
     *
     * The exact gross-up is $0.037012 and the published rate is $0.037, which
     * is a deliberate round DOWN: at 3.7 cents every pack lands on an exact
     * cent, and a price nobody has to explain is worth more than the
     * difference. That difference is 0.0034% — about 1.1 cents on the $37.00
     * pack — so it is bounded here rather than waved through, and a future
     * edit that quietly erodes the margin fails this.
     */
    const retained = CREDIT_PRICE_AUD * (1 - GST_SHARE_OF_INCLUSIVE - CARD_FEE_RATE);
    const shortfall = (RETAINED_PER_CREDIT_AUD - retained) / RETAINED_PER_CREDIT_AUD;
    expect(shortfall).toBeLessThan(0.0005);
    expect(shortfall).toBeGreaterThanOrEqual(0);
  });

  it('prices every pack on an exact cent, so no total needs explaining', () => {
    for (const pack of CREDIT_PACKS) {
      const cents = Math.round(pack.credits * CREDIT_PRICE_AUD * 100);
      expect(Number(pack.priceAud)).toBeCloseTo(cents / 100, 10);
    }
  });

  it('sells nothing below the break-even pack size', () => {
    // A fixed ~30c per transaction against $0.011/scan of inference means a
    // small enough pack loses money however it is priced. The 10-pack did.
    const FIXED_FEE = 0.3;
    for (const pack of CREDIT_PACKS) {
      const retained =
        pack.credits * CREDIT_PRICE_AUD * (1 - GST_SHARE_OF_INCLUSIVE - CARD_FEE_RATE) - FIXED_FEE;
      expect(
        retained,
        `${pack.credits} credits retains $${retained.toFixed(4)} against $${(pack.credits * MODEL_COST_AUD).toFixed(2)} of inference`,
      ).toBeGreaterThan(pack.credits * MODEL_COST_AUD);
    }
  });

  it('advertises exactly what migration 0029 charges', () => {
    const charged = pricesFromMigration();

    // A parse that silently matched nothing would make this pass forever.
    expect(charged.size).toBe(5);

    for (const pack of CREDIT_PACKS) {
      const dbPrice = charged.get(pack.credits);
      expect(dbPrice, `no credits_${pack.credits} row in 0029`).toBeDefined();
      expect(
        Number(pack.priceAud),
        `the site says $${pack.priceAud} for ${pack.credits} credits, the database charges $${dbPrice}`,
      ).toBeCloseTo(dbPrice as number, 4);
    }
  });

  it('sells the bundles the owner named, less the retired 10-pack', () => {
    expect(CREDIT_PACKS.map((p) => p.credits)).toEqual([50, 100, 200, 500, 1000]);
  });

  it('prints money as a decimal string with two places, never a float', () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.priceAud).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
