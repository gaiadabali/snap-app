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

/** What we must RETAIN per credit, after everything has been taken out of it. */
export const RETAINED_PER_CREDIT_AUD = MODEL_COST_AUD * PRICE_MULTIPLE;

/**
 * GST as a share of a GST-INCLUSIVE price. Ten per cent added to an ex-GST
 * price is one eleventh of the inclusive one, which is the figure that matters
 * when grossing up.
 *
 * ASSUMES THE BUSINESS IS REGISTERED FOR GST. Registration is compulsory only
 * above $75,000 turnover; below it, charging or stating GST is not permitted.
 * If that is not true yet, this becomes 0 — see the note in migration 0029.
 */
export const GST_SHARE_OF_INCLUSIVE = 1 / 11;

/** The proportional part of card processing. The fixed part is deliberately absent. */
export const CARD_FEE_RATE = 0.0175;

/**
 * One price, with everything already in it.
 *
 * The customer sees a single number and that number covers the inference, the
 * margin, GST and the card fee. Nothing is added at checkout. So the rate is
 * grossed UP from what has to survive the deductions:
 *
 *     0.0330 / (1 - 1/11 - 0.0175) = $0.037012...
 *
 * Published as $0.037, which is not a convenience rounding: at 3.7 cents every
 * pack on sale lands on an exact cent, so no total needs explaining.
 *
 * WHAT IS NOT IN IT: the fixed ~30c per transaction. It cannot be, while
 * pricing is flat — a per-transaction cost spread over a variable number of
 * scans is a different per-scan price for every pack, which is the taper the
 * owner rejected. Absorbing it means the retained multiple climbs with pack
 * size (2.45x at 50 credits, 2.97x at 1000) instead of sitting at exactly 3x.
 * Flat pricing and an exact 3x everywhere cannot both hold.
 */
export const CREDIT_PRICE_AUD = 0.037;

/**
 * The bundles on sale, smallest first. Matches the ACTIVE rows of
 * `credit_packs` after migration 0029.
 *
 * The 10-pack is retired, not deleted: at $0.33 it netted about two cents
 * after the fixed card fee against $0.11 of inference, so it lost money on
 * every sale — the only pack that did, with break-even at about fourteen
 * credits. It also duplicated the ten scans every new account already gets.
 */
export const PACK_SIZES = [50, 100, 200, 500, 1000] as const;

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
