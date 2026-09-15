/**
 * House ad inventory — D25.
 *
 * `docs/ECOSYSTEM.md` D25 is the binding brief: our own inventory first
 * (free-tax-returns, yourtal, our own paid tiers), served from our own code so
 * a screen holding someone's financial records never loads a third-party
 * script. This file IS that inventory — plain data, no JSX, so it can be
 * imported from a Server Component page (to read `HOUSE_ADS` or call
 * `selectHouseAd` for a static check) or a client component (the actual
 * `HouseAd` slot, which needs `localStorage` for dismissal) without either
 * side pulling in the other's runtime.
 *
 * ── The rules this file exists to satisfy (D25, verbatim) ──────────────────
 * - Never between a person and a task they started — enforced by callers:
 *   this module has no opinion on placement *within* a page, only which
 *   screens (`AdPlacement`) an entry may appear on at all. Nobody has wired a
 *   review screen, the ledger, or a BAS surface into this list, and nobody
 *   should — see the placement comment on `AdPlacement` below.
 * - One slot per screen — a `<HouseAd>` renders at most one entry; the array
 *   below is the POOL a placement chooses from, not a stack that renders
 *   every match.
 * - Labelled — enforced by the component, not this file: `HouseAd` always
 *   renders a visible "Ad" badge. This module only supplies headline/body/CTA
 *   copy, never markup that could be mistaken for the label itself.
 * - No fabricated proof / nothing says "Soon" — an entry whose destination
 *   does not exist yet is not eligible at all (see `FREE_TAX_RETURNS_URL`
 *   below), rather than shipping with a dead link.
 */

/**
 * Where a `<HouseAd>` slot may legally sit, per D25's placement rules.
 *
 * Deliberately excludes:
 *  - any document review screen (`/app/documents/[id]`, `/app/business/documents/[id]`)
 *    — "never between a person and a task they started."
 *  - the business ledger and any BAS surface (`/app/business/ledger`,
 *    `/app/business/bas`, the BAS figures on `/app/business` itself) — "never
 *    on the review screen, the ledger, or any BAS surface."
 *  - `/app/plan` — it already IS an upgrade surface; a house ad there would be
 *    promoting the page the reader is already on.
 *  - any settings/connections flow — those are a task the person started
 *    (editing a business profile, wiring up Xero), not a place to browse.
 *
 * Add a new value here only after checking it against those four rules, not
 * just against "is there room in the layout."
 */
export type AdPlacement =
  | 'individual-documents'
  | 'individual-analytics'
  | 'individual-goals'
  | 'individual-mileage'
  | 'individual-categories';

/**
 * What a page may tell the slot about the viewer, entirely optional.
 *
 * `<HouseAd placement="…" />` with no second argument is a complete,
 * correct usage — every entry without an `eligible` predicate simply always
 * qualifies. `context` exists so a page that ALREADY has the data (most
 * don't fetch it just for this) can sharpen targeting, e.g. an upgrade
 * prompt that only makes sense on the free plan.
 */
export interface HouseAdContext {
  /** `PlanUsage.planCode` (see `@snap/api-contract`), e.g. `"free"`. */
  planCode?: string;
}

export interface HouseAdEntry {
  /**
   * Stable identity, also the dismissal key persisted client-side. Bump this
   * (not just the copy) when the creative changes meaningfully — reusing an
   * id un-dismisses nothing, and a new id means someone who dismissed the old
   * pitch sees the new one once, which is the correct behaviour.
   */
  id: string;
  /** Screens this creative is allowed to appear on. */
  placements: readonly AdPlacement[];
  /** Sentence case, one line, no full stop needed. Real voice, never lorem. */
  headline: string;
  /** One line of body copy. */
  body: string;
  /** Where the CTA goes — an internal path, or an external URL. */
  href: string;
  ctaLabel: string;
  /**
   * Optional narrowing. Evaluated with whatever `context` the calling page
   * supplied (`{}` if none) — write predicates that fail closed on missing
   * data if showing to the wrong viewer would be actively wrong, and fail
   * open if it would just be untargeted.
   */
  eligible?: (context: HouseAdContext) => boolean;
}

/**
 * The one reviewed partner slot D25 asks for is not a second code path — it
 * is just another entry in `HOUSE_ADS` with its own `href`. Nothing here
 * renders an iframe, loads a remote script, or calls out to an ad SDK; every
 * creative is data this file holds, so "drop in a partner later" means
 * "add an object to this array," never "add a script tag."
 */

/**
 * free-tax-returns' production URL is not decided yet (no domain is recorded
 * anywhere in `docs/`), so this reads it from configuration rather than
 * guessing one. Until it is set, the entry below is simply not eligible —
 * exactly the "no eligible inventory renders nothing" behaviour the slot
 * already has to support, so an unconfigured destination costs nothing and
 * ships no dead link. Set `NEXT_PUBLIC_FREE_TAX_RETURNS_URL` once the domain
 * exists (see `apps/web/.env.example`).
 */
const FREE_TAX_RETURNS_URL = process.env.NEXT_PUBLIC_FREE_TAX_RETURNS_URL;

export const HOUSE_ADS: readonly HouseAdEntry[] = [
  {
    id: 'free-tax-returns-2026-09',
    placements: ['individual-documents', 'individual-analytics', 'individual-categories'],
    headline: 'your receipts are already the worksheet',
    body: 'everything you scan here carries straight into free-tax-returns — nothing to re-type for the return itself.',
    href: FREE_TAX_RETURNS_URL ?? '',
    ctaLabel: 'Do your return',
    // Fails closed: an unconfigured destination must never render as a link to nowhere.
    eligible: () => Boolean(FREE_TAX_RETURNS_URL),
  },
  {
    id: 'yourtal-points-2026-09',
    placements: ['individual-goals', 'individual-mileage', 'individual-documents'],
    headline: 'Every scan is already earning',
    body: 'One point per receipt, building quietly. Spending them in yourtal is coming — we will say so the day it lands, not before.',
    href: '/app/points',
    ctaLabel: 'See your points',
  },
  {
    id: 'upgrade-sole-trader-2026-09',
    placements: ['individual-mileage', 'individual-categories', 'individual-analytics'],
    headline: 'Free covers 20 receipts a month',
    body: 'Sole Trader lifts that to 150 for $29/month, so the quota stops being what decides when you stop scanning.',
    href: '/app/plan',
    ctaLabel: 'Compare plans',
    // Fails open when the page hasn't told us the plan (most haven't); fails
    // closed the moment it knows the viewer is already past free.
    eligible: (context) => context.planCode === undefined || context.planCode === 'free',
  },
];

/**
 * Picks the first eligible, undismissed entry for a placement — array order
 * is priority order. Pure and DOM-free on purpose: the component that reads
 * `localStorage` is a thin wrapper around this, so the actual selection logic
 * is unit-testable without a browser.
 *
 * Returns `null` when nothing qualifies, which the caller must render as
 * nothing — never a placeholder box.
 */
export function selectHouseAd(
  placement: AdPlacement,
  context: HouseAdContext,
  dismissedIds: ReadonlySet<string>,
): HouseAdEntry | null {
  for (const ad of HOUSE_ADS) {
    if (!ad.placements.includes(placement)) continue;
    if (dismissedIds.has(ad.id)) continue;
    if (ad.eligible && !ad.eligible(context)) continue;
    return ad;
  }
  return null;
}
