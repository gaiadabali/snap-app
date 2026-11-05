/**
 * The website must advertise the price the checkout will actually charge.
 *
 * `credit_packs` (migration 0051) is what a customer is charged;
 * `credit-packs.ts` is what the pricing page says. A page quoting a price the
 * checkout does not honour is a misleading representation under ACL s18, so
 * this reads the migration and compares.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CARD_FEE_FIXED_AUD,
  CARD_FEE_RATE,
  CREDIT_PACKS,
  CREDIT_PRICE_AUD,
  GST_SHARE_OF_INCLUSIVE,
  MODEL_COST_AUD,
  POINT_COST_AUD,
} from './credit-packs';

const MIGRATION = join(
  __dirname,
  '../../../../../../packages/db/migrations/0051_credit_packs_ten_cents.sql',
);

describe('credit pack pricing', () => {
  it('is 10c a scan: packs of 50 / 100 / 250 for A$5 / 10 / 25', () => {
    expect(CREDIT_PRICE_AUD).toBe(0.1);
    expect(CREDIT_PACKS).toEqual([
      { credits: 50, priceAud: '5.00' },
      { credits: 100, priceAud: '10.00' },
      { credits: 250, priceAud: '25.00' },
    ]);
  });

  it('still profits on every pack after GST, Stripe, reading and the YourTal point', () => {
    for (const pack of CREDIT_PACKS) {
      const price = Number(pack.priceAud);
      const net =
        price * (1 - GST_SHARE_OF_INCLUSIVE - CARD_FEE_RATE) -
        CARD_FEE_FIXED_AUD -
        pack.credits * (MODEL_COST_AUD + POINT_COST_AUD);
      expect(net / pack.credits, `${pack.credits} pack per scan`).toBeGreaterThan(0.04);
    }
  });

  it('advertises exactly what migration 0051 charges', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const charged = new Map<number, number>();
    const re = /price_aud\s*=\s*([\d.]+)[^;]*WHERE\s+code\s*=\s*'credits_(\d+)'/gi;
    for (const m of sql.matchAll(re)) charged.set(Number(m[2]), Number(m[1]));
    for (const m of sql.matchAll(/\('credits_(\d+)',\s*\d+,\s*([\d.]+)/g)) {
      charged.set(Number(m[1]), Number(m[2]));
    }
    // A parse that silently matched nothing would make this pass forever.
    expect(charged.size).toBe(3);
    for (const pack of CREDIT_PACKS) {
      expect(Number(pack.priceAud), `credits_${pack.credits}`).toBeCloseTo(
        charged.get(pack.credits) as number,
        4,
      );
    }
  });

  it('prints money as a decimal string with two places, never a float', () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.priceAud).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
