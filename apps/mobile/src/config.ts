/**
 * Feature flags for this client.
 *
 * A flag lives here as an exported constant, never as commented-out code:
 * commented code stops being typechecked and rots the first time a shared
 * type changes underneath it.
 */

/**
 * YourTal's public web origin, for the points screen's links to YourTal's
 * Me page (where a link code comes from) and its wallet. Same staging default
 * as the server's `YOURTAL_WEB_URL`; inlined at build time.
 */
export const YOURTAL_WEB_URL = (
  process.env.EXPO_PUBLIC_YOURTAL_WEB_URL || 'https://yourtal.gaiada.com'
).replace(/\/+$/, '');

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

/**
 * Whether experimental surfaces are shown at all.
 *
 * OFF by default, and nothing sets `EXPO_PUBLIC_EXPERIMENTAL_FEATURES_ENABLED`
 * in any build. Unlike `BUSINESS_FEATURES_ENABLED`, these screens are ones the
 * SERVER CANNOT HONOUR yet, not merely ones the release does not target:
 * `app/fingerprint.tsx` records a preference that locks nothing, and the
 * wallet and alerts screens read `v1/wallet/cards` and `v1/alerts`, which the
 * server serves from in-process Maps
 * (`apps/server/src/redesign/redesign.controller.ts`). A card saved there is
 * gone at the next restart, and every merge to main restarts the server. A
 * screen that looks like it keeps your card is worse than no screen.
 *
 * Each surface is hidden twice: its entry point is removed (the home bell,
 * the privacy "fingerprint" row) and the screen
 * redirects away, because a route still navigable by URL is only unadvertised.
 * The credits screen also stops asking for a payment method while this is
 * off: the card was only ever a label, so a pack alone is enough to pay.
 *
 * Expo inlines `EXPO_PUBLIC_*` at build time, so turning this on is a rebuild.
 * Only the exact string `'true'` enables it.
 */
export function experimentalFeaturesEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export const EXPERIMENTAL_FEATURES_ENABLED = experimentalFeaturesEnabled(
  process.env.EXPO_PUBLIC_EXPERIMENTAL_FEATURES_ENABLED,
);
