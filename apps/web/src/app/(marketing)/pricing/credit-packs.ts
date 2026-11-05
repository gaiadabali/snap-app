/**
 * What a scan costs, and what the packs are.
 *
 * Settled by the founder 2026-10-20 (group plan 0.11.a): about 10c a scan, in
 * packs of 50 / 100 / 250 for A$5 / 10 / 25, GST included. One scan is one
 * credit.
 *
 * The prices a customer is CHARGED live in `credit_packs`, set by migration
 * 0051. A marketing page that hardcodes its own copy of them is one careless
 * edit away from advertising a price the checkout does not honour (ACL s18), so
 * `credit-packs.test.ts` reads the migration and fails if the two disagree.
 *
 * Per scan on the A$5 pack (docs/MONETISATION.md section 3): 9.09c after GST,
 * less 0.77c Stripe, about 0.5c to read and store, less 3c for the YourTal
 * point, leaves about 4.8c.
 */

/** Measured all-in cost of a scan: Gemma 4 31B (A$0.0005) plus five years of storage. */
export const MODEL_COST_AUD = 0.0027;

/** GST as a share of a GST-INCLUSIVE price (one eleventh). Assumes GST registration. */
export const GST_SHARE_OF_INCLUSIVE = 1 / 11;

/** Card processing: the proportional part, and the fixed part per transaction. */
export const CARD_FEE_RATE = 0.0175;
export const CARD_FEE_FIXED_AUD = 0.3;

/** What Snap Apps pays YourTal for the point a bought-credit receipt earns. */
export const POINT_COST_AUD = 0.03;

/** One price, with everything already in it. */
export const CREDIT_PRICE_AUD = 0.1;

/**
 * The bundles on sale, smallest first. Matches the ACTIVE rows of
 * `credit_packs` after migration 0051; the older packs are retired, not deleted.
 */
export const PACK_SIZES = [50, 100, 250] as const;

/** Scans a brand-new account starts with — `usage_grants.source = 'signup_bonus'`. */
export const FREE_SCANS_AT_SIGNUP = 10;

export type CreditPack = {
  credits: number;
  /** Decimal string, because money is never a float on this surface. */
  priceAud: string;
};

/**
 * Money as a decimal string — `docs/WEB.md` §3.2. `toFixed` is doing rounding
 * on a float here, which is exactly what that rule exists to prevent
 * elsewhere; it is acceptable at this one boundary because the inputs are a
 * fixed rate and a whole count, and the result is asserted against the
 * migration's own figures in the test.
 */
export function packPrice(credits: number): string {
  return (credits * CREDIT_PRICE_AUD).toFixed(2);
}

/** The GST inside a pack's price, for a receipt line. */
export function packGst(credits: number): string {
  return (credits * CREDIT_PRICE_AUD * GST_SHARE_OF_INCLUSIVE).toFixed(2);
}

export const CREDIT_PACKS: readonly CreditPack[] = PACK_SIZES.map((credits) => ({
  credits,
  priceAud: packPrice(credits),
}));
