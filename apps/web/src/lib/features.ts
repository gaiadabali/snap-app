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

/**
 * DESIGN_LAB_ENABLED — the 3D spike surface at `/lab/*`.
 *
 * `docs/DESIGN-HANDOFF.md` §12.1 records three art directions that were all
 * rejected as generated-looking, which is the reason this route exists at all:
 * a WebGL direction has to be looked at before it is wired into the pages that
 * sell the product, not after. `/lab/capture` renders the scene large, in both
 * themes, beside the flat card it would replace.
 *
 * Off in production. A lab route that ships is a "Soon" page by another name
 * (§3.5), and the spike's whole purpose is that it might be deleted.
 */
export const DESIGN_LAB_ENABLED = process.env.NODE_ENV !== 'production';

/**
 * SCENES_3D_ENABLED — the WebGL document scenes on the marketing pages.
 *
 * ON by default, and killable from the outside: set `SNAP_WEB_3D=off` in
 * `deploy/.env` and restart the web container. Deliberately a PLAIN env var,
 * not a `NEXT_PUBLIC_` one — public vars are inlined at build time, so turning
 * one off means a rebuild, a CI run and a re-deploy, which is the wrong shape
 * of lever for the thing it is guarding.
 *
 * It is guarding a real uncertainty. The scenes degrade on their own for
 * reduced motion, save-data, low memory and missing WebGL (see
 * `src/design/three/capability.ts`), and every one of them falls back to the
 * flat ledger card that is the actual content. What none of that covers is a
 * whole class of device we have not seen it on — the scenes were verified
 * against software rendering, not a real mobile GPU, and the buyer is a tradie
 * on a phone (docs/DESIGN-HANDOFF.md §12.3). If it looks wrong out there, this
 * is how it goes off in the time it takes to restart a container.
 *
 * Read on the SERVER and passed down as a prop. The island is a client
 * component and `process.env` is empty there, so reading it inside the island
 * would silently evaluate to "on" no matter what the host is set to.
 */
export const SCENES_3D_ENABLED = process.env.SNAP_WEB_3D !== 'off';
