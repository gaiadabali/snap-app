/**
 * Feature flags for surfaces that can be switched fully on or off.
 *
 * A flag, not deletion, and not commented-out code. Code behind a flag stays
 * compiled, typechecked, and refactored alongside everything else — turning
 * the flag back on is the whole point, and it has to actually work.
 */

/**
 * BUSINESS_SURFACES_ENABLED — off by design (2026-09-15).
 *
 * Hansel asked to hide every business/practice surface so the personal
 * (sole-trader) experience can be designed properly on its own, without a
 * second workspace kind competing for the same screens. This is deliberate
 * and reversible:
 *
 *  - `/app/business/*` returns `notFound()` — see
 *    `src/app/app/business/layout.tsx`. The routes, pages and server actions
 *    underneath are untouched and still compile.
 *  - The panel's "Switch to business" link disappears (`(individual)/layout.tsx`).
 *  - The marketing home page (`(marketing)/page.tsx`) and `/pricing`
 *    (`(marketing)/pricing/`) show only the personal / sole-trader side —
 *    no practice door, no Practice or Practice Plus plans, no "Practices"
 *    footer column.
 *
 * **The tension this hides, on purpose:** `docs/MONETISATION.md` §3 is
 * explicit that Practice ($19/client/month) is the primary revenue line and
 * Direct/Sole Trader is the funnel underneath it. Turning this off hides the
 * revenue story from every visitor, not just a UI section — see the report
 * this shipped with for what a viewer no longer sees.
 *
 * **To turn business surfaces back on:** flip this to `true`. Nothing else
 * needs to change — every business route, nav entry and marketing section is
 * still there, still typechecked, still tested. Re-verify:
 *  - `/app/business/*` renders again for a member of a business workspace.
 *  - The workspace switcher's "Switch to business" link reappears.
 *  - The marketing home page and `/pricing` show both doors / all four plans
 *    again.
 */
export const BUSINESS_SURFACES_ENABLED = false;
