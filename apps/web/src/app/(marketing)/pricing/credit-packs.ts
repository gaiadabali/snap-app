/**
 * What a scan costs, derived rather than typed out.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Settled by the owner 2026-09-17:
 *
 *     price per scan = cost of one real model scan × 3
 *
 * `docs/MONETISATION.md` §5 measures that cost — extraction is ~$0.011/scan
 * blended (Haiku 4.5 primary, Sonnet 5 escalation) — so a credit is $0.033 and
 * a pack is simply that rate times its size. One scan is one credit.
 *
 * ── Why this is computed and not a list of prices ─────────────────────────
 *
 * The prices a customer is CHARGED live in `credit_packs`, seeded by migration
 * 0027 from the same rule. A marketing page that hardcodes its own copy of
 * them is one careless edit away from advertising a price the checkout does
 * not honour — which for a consumer product in Australia is a misleading
 * representation under ACL s18, not merely an embarrassment.
 *
 * So both sides derive from the rule instead of restating a number, and
 * `credit-packs.test.ts` reads the migration and fails if the two ever
 * disagree. Change the rate here and the test tells you the database is stale;
 * change it there and the test tells you the website is.
 */

/** Blended model cost of a single extraction, from MONETISATION.md §5. */
export const MODEL_COST_AUD = 0.011;

/** The owner's multiple. */
export const PRICE_MULTIPLE = 3;

/** What one credit — one scan — costs, GST-inclusive AUD. */
export const CREDIT_PRICE_AUD = MODEL_COST_AUD * PRICE_MULTIPLE;

/** The bundles on sale, smallest first. Matches `credit_packs` in 0027. */
export const PACK_SIZES = [10, 50, 100, 200, 500, 1000] as const;

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

export const CREDIT_PACKS: readonly CreditPack[] = PACK_SIZES.map((credits) => ({
  credits,
  priceAud: packPrice(credits),
}));
