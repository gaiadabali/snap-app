# Snap Apps — the website

**Status:** all surfaces built · **Date:** 2026-09-12
**Verified:** 61 routes build clean · web 37 tests · server 187 tests ·
db 197 tests (needs a real `DATABASE_URL`, see below) · boundaries 11 tests
**App:** `apps/web` · Next.js 15 App Router · React 19 · Tailwind v4 (CSS-first)

This document is the contract. Several people build on this scaffold at once, and
consistency is not going to come from taste — it comes from here.

---

## 1. What this is

Five surfaces in one Next application:

| Surface | Route | Who |
|---|---|---|
| **Marketing** | `/`, `/features`, `/pricing`, `/how-it-works` | Anyone |
| **Support & docs** | `/support`, `/docs/*`, `/legal/*` | Anyone |
| **Downloads** | `/download` | Anyone |
| **Registration & sign-in** | `/register`, `/sign-in`, `/auth/*` | Anyone |
| **Individual panel** | `/app/*` | A signed-in person |
| **Business panel** | `/app/business/*` | A business workspace |
| **Platform admin** | `/admin/*` | Platform staff only |

One application rather than several, because the marketing site and the panels
share the design system, the session, and the deployment. Split later if the
marketing site ever needs a different release cadence — not before.

---

## 2. What already exists — build on it, do not rebuild it

| Thing | Where | Note |
|---|---|---|
| Design tokens | `src/app/globals.css` | Light + dark, type roles (`.t-display` `.t-head` `.t-label`), scroll-driven motion. **Never hard-code a colour.** |
| Marketing primitives | `src/design/primitives/index.tsx` | `Section` `SectionHead` `Rule` `LedgerRow` `Reveal` `ArrowLink` — the ledger language, see §4 |
| Panel primitives | `src/design/primitives/index.tsx` | `Container` `Card` `Button` `Badge` `Money` `Stat` `Field` `Input` `SectionTitle` `Empty` `Table` |
| Server API client | `src/lib/api/server.ts` | `api<T>()`, `ApiError`, cookie names |
| Config | `src/lib/config.ts` | `server-only`. No secret defaults. |

The backend is **already built and running**: NestJS on Fastify, 61 routes,
OpenAPI at `/v1/openapi.json`. Wire types live in `@snap/api-contract`, which
the server imports too — so the two sides **cannot drift without failing to
compile**. Import types from there. Do not redeclare a response shape.

Read `apps/mobile/src/api/types.ts` (the `SnapApi` seam) to see what the API can
already answer. Most panel work is a new view over an existing endpoint.

---

## 3. Rules that are not negotiable

### 3.1 The session token never reaches the browser

It lives in an **httpOnly cookie** and is attached server-side by
`src/lib/api/server.ts`. Client components therefore **cannot call the API
directly** — they call a server action or a route handler in this app, which
calls `api()`. That is the intended shape, not an obstacle to route around.

One XSS on a page that holds a bearer token is an attacker downloading five
years of someone's financial records.

### 3.2 Money is a decimal string, always

`@snap/api-contract` says it plainly: a JSON float cannot hold `110.10` exactly
and a BAS out by a cent is wrong. Render money with `<Money amount={...} />`.
**Never `parseFloat`, never `Number()`, never arithmetic in the browser.** If a
total is needed, the server computes it.

### 3.3 Every write carries an `Idempotency-Key`

Generate one per **user intent**, not per retry — `newIdempotencyKey()`. The
server enforces claim-then-record so two concurrent retries cannot both proceed.
`api()` warns when a write is missing one.

### 3.4 Both themes, every time

A token has its definition on bare `:root` and is *redefined* for dark. Check
your surface in both. A panel that is only legible in light is half-built.

### 3.5 Nothing says "Soon"

The mobile app cleared this bar (`docs/PLAN.md`, phase 5c) and so does this.
No dead links, no empty `onClick`, no placeholder that ships. Use `<Empty>` with
a real explanation when there is genuinely nothing to show.

---

## 4. The design language — how not to look generic

**Rewritten 2026-09-14.** The site had good copy inside a template: every
section was `border-b` + alternating `bg-surface` + eyebrow/title/lede + a
two-column grid + a rounded, shadowed card, seven times down the page. Specific
writing cannot rescue a metronome. What follows replaced it.

### 4.1 The ledger, not the card deck

Accountancy's native visual form is **ruled paper and aligned columns**, not a
deck of boxes. So the marketing surface is set like a ledger:

- **Hairlines spanning the measure**, not borders wrapped around content.
- **Figures locked to a right-hand column**, mono and tabular.
- **A left gutter carrying a real code** — `G11`, `1B`, `D1–D5`, or the actual
  database table (`captures`, `extraction_runs`, `documents`, `transactions`).
  Never `01 / 02 / 03`. A structural marker should teach something; these are
  the labels the product assigns, so the furniture does real work.
- **Every section a different shape.** If two consecutive sections share a
  silhouette, one of them is wrong.

Use `Section`, `SectionHead`, `Rule`, `LedgerRow`, `Reveal` and `ArrowLink` from
`src/design/primitives`. `Card` survives for the **panels**, where a bounded box
genuinely helps a dense queue.

### 4.2 Colour — identity blues on docket paper

The identity colours are still **measured, not invented**: `#1878D8` dominant,
`#0060C0` deep, `#1CA8DB` scan line, shared byte-for-byte with
`apps/mobile/src/theme/tokens.ts`. **Those did not change and must not drift.**

What changed is the **grounds**. They used to be blue as well (`#F2F7FE` /
`#E5EFFC`), which meant the brand blue sat on a tinted version of itself and
stopped reading as an accent at all. They are now docket paper — a faintly warm
off-white (`#FAF9F7`) under a cool blue. That temperature contrast is what makes
`#1878D8` finally register.

> **Open item:** `apps/mobile/src/theme/tokens.ts` still has the blue grounds.
> "One palette, two clients — change it in both or in neither" is still the
> rule, so mobile's `ground` / `surface` / `surfaceAlt` / `rule` / `ruleStrong`
> need the same neutralisation. The identity colours need no change there.

Red still means **money at risk**, never decoration.

### 4.3 Type — Archivo and IBM Plex Mono

Two families, self-hosted by `next/font`, exposed as `--font-sans` / `--font-mono`.

- **Archivo** for everything spoken. Set **large and light** (weight 300) with
  negative tracking — `.t-display`, `.t-head`, `.t-sub`. The airy headline is
  the site's voice; do not bold it back to a SaaS default.
- **IBM Plex Mono** for everything *machine*: figures, ATO labels, table names,
  receipt lines, and `.t-label` (11px, `0.18em` tracking, uppercase). A receipt
  really is printed in mono; this is domain truth, not a style.

The old rule said system fonts only, because "a custom face can fail to load
five minutes before a demo". That is a **React Native** concern and stays true
in `apps/mobile`. On web, `next/font` self-hosts from our own origin with a
metric-matched fallback, so these cannot fail independently of the app.

### 4.4 Motion — scroll-driven CSS, plus WebGL islands

**Page motion** is **native CSS scroll timelines** (`animation-timeline: view()`
and `scroll()`), not GSAP and not Framer Motion. This is an architectural
choice, not a taste one: the marketing pages are React **Server Components**,
and both libraries would force `'use client'` across the whole tree plus
~40–45 KB gz to fade a heading in. CSS timelines run on the compositor and ship
nothing. That is still true of every page-level animation and is not up for
renegotiation to fade a heading in.

**The one exception, shipped 2026-09-17:** `/features` and `/how-it-works`
render the hero docket as a WebGL scene (`src/design/three/`). The heading of
this section used to say "zero JavaScript" and that is no longer literally
true, so it says this instead.

The exception is bounded by a rule, and the rule is what keeps the claim above
honest — **the twin is the content, the canvas is a picture of it**:

```
<CaptureScene enabled={SCENES_3D_ENABLED}>   client island
  <ReceiptScanCard />                        server-rendered, always in the DOM
</CaptureScene>
```

The server renders the flat card. The canvas mounts over it and fades it out
only after WebGL has a frame up, and the canvas is `aria-hidden` because every
figure in it is a picture of a number. So first-load JS on every marketing
route is **unchanged** (109.2 KB gz on `/`), the 3D payload (241.9 KB gz) is in
no route's first-load manifest, and it is never fetched at all for: reduced
motion, `saveData`, `deviceMemory < 4`, no WebGL2, no JS, or a crawler. All of
them get the card that already shipped.

Two things that follow, and both have already caught a bug:

- **A scene may not be the only place a figure exists.** If deleting the canvas
  would lose information, the scene is carrying content it should not.
- **Verify the refusals, not just the happy path.** The checks that matter are
  "canvas count is 0" and "the worked example is still in the DOM", under
  reduced motion and with WebGL disabled.

**The kill switch:** `SNAP_WEB_3D=off` in `deploy/.env` plus a web container
restart. A plain env var rather than `NEXT_PUBLIC_` on purpose — a public var is
inlined at build time, so switching it would need a rebuild, a CI run and a
redeploy, which is the wrong shape of lever for an escape hatch.

Utilities live in `globals.css`: `.anim-rise` `.anim-fade` `.anim-deal`
`.anim-drift` `.anim-wipe` `.anim-expand` `.anim-progress`, plus `.anim-load`
for the above-the-fold hero, which has no scroll entry to animate against.

**Two rules that are not negotiable:**

1. **The rest state lives INSIDE `@supports (animation-timeline: view())`.** A
   browser without scroll timelines must get the finished content statically —
   never a blank page waiting for an observer that will never fire.
2. **`prefers-reduced-motion: reduce` disables all of it**, and the page must
   still be fully legible. Verified: 0 animated elements below 0.9 opacity at
   rest under reduced motion.

Motion should show state changing or reward scrolling. It never hides content.

**What gives this its character** — use these deliberately:

1. **The scan line.** `.scan-line` is the teaser's motif. It belongs on capture,
   processing, and extraction states. It is a signature, so it stops being one
   if it decorates a pricing table.
2. **Tabular numerals everywhere a figure appears.** `.tabular`, and `<Money>`
   applies it. A number that shifts as it updates reads as untrustworthy, and
   this product's whole pitch is that the numbers are right.
3. **One inverted band per page, maximum.** `Section tone="void"` is spent on
   the sharpest content — the "$342.18 you cannot claim" figure. A second one
   spends the effect.
4. **Density is a feature in the panels.** An accountant reviewing 200 documents
   wants rows, not cards with 40px of padding. Marketing breathes; panels work.
5. **Real figures, never lorem.** Use plausible AU amounts, real category names,
   an actual ABN shape. And make worked examples **actually reconcile** — the
   hero's docket sums to its own splits, because a balanced-books claim sitting
   above arithmetic that does not balance is the worst possible own goal.

**What reads as generic — avoid:**
- Purple/indigo gradient heroes, floating glass cards, a wall of emoji feature icons.
- Three identical pricing cards with a "MOST POPULAR" ribbon.
- Alternating `bg-surface` bands as the only structural device. That is what was
  removed; do not reintroduce it.
- Generic stock abstraction. This is a tax compliance product for Australian
  tradies; it should feel precise and grounded, not like a crypto launch.
- Animation that has no informational job. Motion should show state changing.

### 4.5 The home page is a conversion surface, not a proof

An earlier revision of `/` led with the pipeline architecture — `captures` →
`extraction_runs` → `documents` → `transactions` — and put per-category tax
subtotals in the fourth section. `docs/MONETISATION.md` rules against both:

- §2.1: provenance and audit architecture are **"procurement words for a buyer
  we are not selling to."** That material moved to `/how-it-works`, where
  someone already interested goes looking for it.
- §2: per-category tax subtotals is **"the single capability no competitor at
  any price currently offers"** and explicitly *"not a schema detail to mention
  in paragraph four."* It is now the headline and the first section.

Three rules the home page now follows:

1. **Both doors above the fold.** Practices are the revenue ($19/client/month,
   one sales motion); sole traders are the funnel (free tier). A hero that
   speaks to only one loses the other.
2. **One worked case, end to end.** Every figure on the page — $18,409.91
   captured, $177.15 at risk, $1,476.70 claimable, $50,570 estimated deductions
   — belongs to **K. Marsh Transport**, the same demo workspace the app
   screenshots come from. Four unrelated invented numbers read as invented; one
   business followed through a quarter reads as a product.
3. **There is no social proof, and that is the settled position.** The proof
   slot (`_components/proof.tsx` + `proof-data.ts`) held two SAMPLE
   testimonials so the section could be design-reviewed with realistic text.
   **They were removed on 2026-09-16** (`docs/DESIGN-HANDOFF.md` §12.4): the
   handoff permits samples only while visibly marked, `next build` refuses a
   production build while any remain, and on a compliance product the honest
   resolution is to carry no testimonials until there are real ones.

   `TESTIMONIALS` is now empty. `Proof` renders correctly without it — the
   quote grid is skipped and the section stands on `MEASUREMENT`, the
   *corrections per 100 documents* figure we have committed to publishing and
   have not measured yet (`docs/MONETISATION.md` §2.1, `docs/GAPS.md` lanes B
   and E). That is stronger proof than a quote anyone could have written.

   **The guard stays armed, and is no longer overridden anywhere.**
   `assertNoPlaceholdersInProduction()` still throws during `next build` if a
   sample is added back. The `SNAP_ALLOW_PLACEHOLDER_PROOF=1` escape hatch
   remains in the function for a future round of design review, but it is no
   longer *set* in `apps/web/Dockerfile`, `.github/workflows/ci.yml` or
   `.github/workflows/publish-images.yml` — all three were removed with the
   samples, as their own comments instructed. While those overrides were in
   place the guard could not have fired in any automated path.

   This is the one place on the site where getting it wrong is a legal problem
   rather than a taste problem: a testimonial from a customer who does not
   exist breaches ACL s29(1)(e)–(f) and s18, and fake reviews are a standing
   ACCC enforcement priority. Replacing a sample means a named person who has
   used the product, written permission on file, `consentedOn` recorded, and
   the quote accurate and in context. `_components/proof.test.ts` enforces the
   guard, that samples and real quotes are never mixed, and that every real
   entry carries a consent date.

   ### The ML Kit disclosure (OD-9)

   `/legal/privacy` §3 and §4 name **Google ML Kit** and state both halves of
   what it does, because only the flattering half is a misleading disclosure:

   - Your photo and the text read from it **stay on the phone** — ML Kit does
     not send the image or its result to Google.
   - Google **does** receive usage and performance metrics from the recogniser,
     and processes them under its own terms. Google's ML Kit Terms *require*
     developers to inform users of this; it is not optional.

   The reason Google is involved at all is the **unbundled** recogniser: the
   model ships from Google Play services rather than inside the APK, which is
   what keeps proprietary weights out of a redistributable image under D23
   (`docs/ON-DEVICE.md` §5). A device without Play services falls back to the
   Sydney extraction.

   **The disclosure deliberately landed BEFORE the feature.** As of
   2026-09-17 the module is built and measured on a handset but is not wired
   to any user-facing screen (OD-8). A privacy notice that arrives after the
   capability is the wrong order; this one is written in the present tense
   about what happens *when* the app reads on-device, which is true whenever
   that path runs and harmless until it does.

   The trust signals that need no customer are already there and are stronger
   than a quote: the capability comparison, the free tier as a self-serve
   demo, the real app screenshots, and the published-but-unmet measurement
   standard (`corrections per 100 documents`) that no competitor publishes.

**The comparison table** (`_components/comparison.tsx`) claims **capability,
never quality** — each cell answers "does it do this at all", which anyone can
check. Accuracy-versus-competitor claims are blocked behind MONETISATION.md
§2.1's two conditions (measured on the `au-receipts` gold set, measured against
Hubdoc and Dext on the same documents) and must not appear before then. The
table is date-stamped because §2 has already had to retract a claim once, when
Ozly shipped a BAS dashboard.

### 4.6 App screenshots — how to re-capture them

`public/screens/*.png` are real captures of `apps/mobile` running in its
fixture-backed demo mode, not mockups. Re-capture whenever the app's UI moves:

```bash
# 1. Build the web bundle with NO api url — that is what selects demo mode
#    (src/api/index.ts: IS_DEMO = API_URL === '').
cd apps/mobile && unset EXPO_PUBLIC_API_URL && pnpm export:web

# 2. Serve .expo-export with SPA fallback, sign in as a demo account
#    (Kate Marsh = business owner), screenshot at 390x844 @2x.
```

Two constraints that are not style preferences:

- **Never write them to `public/app/` or `public/admin/`.** Those shadow the
  middleware-guarded route surfaces, so every image 307s to `/sign-in` for
  signed-out visitors — which is all of them. `src/public-assets.test.ts`
  fails the build if anything lands there; it was written after that bug
  shipped into the working tree.
- **Leave the app's own "Demo" badge in.** The figures are generated, the
  footer says every figure on the site is illustrative, and cropping the badge
  out to make a screenshot look like production data is the one edit that turns
  an honest screenshot into a dishonest one.

### 4.7 Where the language has and has not landed

| Surface | State |
|---|---|
| `/` (home) | **Rebuilt** in the ledger language, **re-sequenced for conversion** (§4.5), and on 2026-09-17 **re-formed to break the metronome** (§12.1): the eight sections no longer all run `Section → SectionHead → content` with alternating tone. Forms now go gutter · wide · gutter · measure · wide · gutter · wide, the tinted bands are gone, and `.page-spine` carries continuity instead. Two WebGL scenes: the capture chamber in the hero and the tax split at G11. |
| Header / footer | **Rebuilt** |
| `public/screens/*`, `_components/app-showcase.tsx`, `_components/comparison.tsx` | **New.** Re-capture per §4.6; `src/public-assets.test.ts` guards the path collision |
| Tokens, type, motion, primitives | **Rebuilt** — everything inherits these |
| `/features`, `/how-it-works` | Inherit the palette, type and primitives, and since 2026-09-17 render the hero docket as a **WebGL scene** over the flat card (§4.4). Copy is **still mechanism-led** and still needs §4.5 applied. |
| `/pricing`, `/docs`, `/download`, `/support`, `/legal` | Inherit the new palette, type and primitives, but **still carry the old zebra-band structure and pill eyebrows**. Port them to `Section` / `SectionHead` / `LedgerRow` — and apply §4.5 to their copy, not just their layout. `/how-it-works` is where the pipeline architecture belongs. |
| `/app/*`, `/admin/*` panels | Inherit the palette and the flatter `Card`. Intentionally unchanged otherwise — panels work, marketing breathes. |

## 5. Ownership map

Work in **your files only**. If you need a shared primitive that does not exist,
add it to `src/design/primitives/index.tsx` — that file is shared, so keep the
edit additive and small.

| # | Scope | Owns |
|---|---|---|
| 1 | Marketing core | `src/app/(marketing)/` — home, features, how-it-works |
| 2 | Support & docs | `src/app/(marketing)/support/`, `/docs/`, `/legal/`, chatbot shell |
| 3 | Pricing & downloads | `src/app/(marketing)/pricing/`, `/download/`, `src/lib/releases.ts` |
| 4 | Auth & registration | `src/app/(auth)/`, `src/app/auth/`, `src/lib/auth/` |
| 5 | Admin plane (backend) | `packages/db/migrations/0021_*`, `apps/server/src/admin/` |
| 6 | Admin: people & tenants | `src/app/admin/(people)/` |
| 7 | Admin: governance & AI | `src/app/admin/(governance)/` |
| 8 | User & business panels | `src/app/app/` |

---

## 6. The platform admin plane — read this before touching it

**It does not exist yet, and it is the most dangerous thing in this codebase.**

Today every role is workspace-scoped (`owner | admin | bookkeeper | member |
readonly`) plus `firm_role`. RLS is built so nothing reads across tenants, and
`0011_firms.sql` says so on purpose: `current_tenant_id()` is *the one isolation
mechanism*, and firm logic was deliberately kept out of tenant policies so the
boundary has one moving part rather than twenty.

A platform admin panel adds a second authorisation surface over every tenant's
financial records. That is exactly the shape of the bug this repo already
shipped once — the server connected as `postgres`, which has `rolbypassrls`, so
**no policy anywhere had ever been evaluated**, and it survived because the
tests only checked the happy path.

So the plane is built to these rules:

1. **A separate identity.** Platform staff are not a `memberships` row with a
   magic value. New table, new role enum, its own audit trail.
2. **A separate database role.** Never `BYPASSRLS`. Cross-tenant reads go
   through an explicit, named, `SECURITY DEFINER` function owned by a `NOLOGIN`
   role — the pattern `0015_identity_plane.sql` already establishes.
3. **Impersonation is a session, not a mode.** Entering a tenant as a user
   mints a distinct, short-lived, revocable token that is visibly marked. Every
   request made under it is attributed to *both* the staff member and the
   subject in `audit_log`. It expires on its own.
4. **The UI can never hide it.** A persistent, unmissable banner naming who is
   being impersonated and offering one-click exit.
5. **Test the refusal.** For every capability, assert the NEGATIVE: a non-staff
   user cannot reach an admin route; a staff member without the capability is
   refused *by the database*; an expired impersonation token is rejected. A
   suite that only proves the happy path is what let the last one through.

### AI keys in the UI

`apps/server/src/config.ts` validates all secrets at startup and has **no secret
defaults**, on purpose. A settable-in-UI API key does not go in a settings row —
it goes in the encrypted-secret pattern the plan already specifies for bank
details: app-level AEAD, KMS-wrapped DEK, ciphertext in `BYTEA`. Not `pgcrypto`
(keys passed in SQL text end up in logs and `pg_stat_statements`). The UI shows
a prefix and last-4, never the value, and writing a key is an audited event.

---

## 7. Known constraints

- **iOS cannot be side-loaded, and the iOS build is not ready.** A public `.ipa`
  download is not a thing, and the app itself is still in development.
  **Decision (2026-09-12):** build the iOS section at full weight anyway — the
  hype should stand and the page should earn its iOS search terms while the
  build is worked on — but the download control is deliberately
  **non-actionable**, with the status stated in visible text.
  Not `<button disabled>` and not an `<a>` without an `href`: the first is
  dropped from the accessibility tree, the second is not a link, and both hide
  the state from the people who most need it announced. Use a focusable element
  with `aria-disabled="true"`, styled unmistakably as unavailable rather than
  merely faded.
  The iOS content must be server-rendered and crawlable, and any
  `SoftwareApplication` JSON-LD must describe an unreleased app **honestly** — a
  false availability claim risks a structured-data penalty and costs exactly the
  SEO the section exists to build. Android APK is fine — `eas.json` already
  builds `preview` APKs.
- **Sign-in is a development stand-in.** `apps/server/src/auth/auth.controller.ts`
  takes an email and no password and says in its own comments it must not ship.
  Google OAuth + email registration is the target; the dev bypass is guarded by
  two independent conditions (`NODE_ENV` and an explicit env flag).
- **Billing has no server routes.** `subscriptions` and `usage_counters` exist
  in schema (0008, 0011); Stripe is phase 6.5 and unbuilt. Wallet/payment panels
  read what exists and must not invent a checkout that has no backend.
- **The firm/practice console needs new server routes.** `firms` and
  `firm_memberships` are schema-only (0011); the server reads nothing from them
  but a plan's `firm_name`. Treat it as a separate build.

---

## 8. Running it

**The database suites self-skip without a `DATABASE_URL`, and a skipped suite
reads as a green run.** `pnpm --filter @snap/db test` reported `197 skipped` and
looked fine; with a real database it is 197 passed. CI must fail when these skip,
or the tenant-isolation and admin-plane proofs quietly stop running — which is
the same shape as the RLS incident in §6. The full environment:

```bash
DATABASE_URL=postgres://snap_app:...@127.0.0.1:PORT/snapapps        # NOT a superuser
WORKER_DATABASE_URL=postgres://snap_worker:...@127.0.0.1:PORT/snapapps
ADMIN_DATABASE_URL=postgres://postgres:...@127.0.0.1:PORT/snapapps  # test provisioning only
TOKEN_SECRET=<32+ chars>
ADMIN_KMS_MASTER_KEY=<64 hex chars>
```

`node packages/db/scripts/db.mjs appuser` prints the first two.

```bash
pnpm --filter @snap/web dev     # http://127.0.0.1:3000
pnpm --filter @snap/server serve # http://127.0.0.1:4000 — needs Postgres
```

`SNAP_API_URL` points the web app at the server. Set `CORS_ORIGINS` on the
server to include the web origin — it is an allow-list and never `*`.

Before you say a surface is done: **run it**. This repo's history is a list of
bugs that only appeared when someone drove the actual screen — `initials`
declared twice and absent from every response, `memberships_self` being
PERMISSIVE and double-counting seats, a drain that could never send because CORS
blocked the header at preflight. None of those were visible in the code.
