/**
 * Feature flags for this client.
 *
 * A flag lives here as an exported constant, never as commented-out code:
 * commented code stops being typechecked and rots the first time a shared
 * type changes underneath it.
 */

/**
 * Whether business-workspace surfaces are shown at all.
 *
 * OFF for the personal-only release (`docs/ECOSYSTEM.md` D24–D27): the
 * consumer economy — credits, points, the free starter scans — ships to
 * individuals first, and the practice/business side (invoices, bills, GST,
 * stock, mileage, tax pack, accounting sync) is not part of that release.
 *
 * Flip this back to `true` to restore the workspace switcher, business home,
 * every business nav entry, and the business option in onboarding — nothing
 * else needs to change, because every one of those surfaces reads this one
 * constant rather than being deleted or commented out.
 */
export const BUSINESS_FEATURES_ENABLED = false;
