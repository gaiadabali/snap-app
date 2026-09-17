# Snap Apps — design handoff

**For:** continuing the UI in Claude Design (claude.ai/design)
**Generated:** 2026-09-15 · from `apps/web` as deployed at commit `f21bcd3`
**Live:** https://snap-apps.gaiada.com/

Every value here is **resolved from the shipping code**, not proposed. Paste
this whole file into Claude Design as context. It is self-contained — nothing
in it depends on reading the repository.

Where something is unsettled, it says so under §12. Read that section before
designing: it is the actual brief.

---

## 1. What the product is

A **BAS and deduction-compliance layer for Australian sole traders and
tradies**, sold through accounting practices. You photograph a tax invoice; it
reads every line, validates the GST against nine deterministic checks, and
posts a balanced double-entry transaction with the right ATO label already
attached.

**Positioning, verbatim from the strategy doc:** *not "a receipt scanner". A
BAS and deduction-compliance layer for Australian sole traders and tradies,
sold through accountants.*

**The one capability no competitor has** — this is the whole wedge, and it
belongs above the fold, not in paragraph four: **per-category tax subtotals.**
One supermarket docket for site lunch mixes GST-free fresh food with taxable
packaged goods. Hubdoc, Dext, ATO myDeductions and Ozly all read header totals
only, so none of them can say which half is which. Snap Apps splits it per line.

---

## 2. Two audiences, two jobs

| | Sole trader / tradie | Accounting practice |
|---|---|---|
| Buys | Free tier, 20 receipts/mo | **$19 per client / month**, min 10 clients |
| Role | The funnel — volume | **The revenue** — one sales motion serves 50 |
| Wants | Not to lose money, not to spend Sunday on receipts | **Fewer minutes per document**, across every client |
| Reads on | A phone, often outdoors, in bright sun | A desktop, all day |

Other plans: Sole Trader $29/mo (150 receipts), Practice Plus $29/client/mo.

The homepage currently serves both with a **split hero** — two doors with the
price on the face of each.

> The practice buyer does **not** buy provenance, residency or audit
> architecture. Those are procurement words for a buyer we are not selling to.
> They buy *fewer corrections per hundred documents.* Design accordingly.

---

## 3. Non-negotiables

Things a redesign may not quietly change:

1. **The identity colours are measured, not chosen.** `#1878D8`, `#0060C0` and
   the `#1CA8DB` scan cyan are sampled from the launch film and shared
   byte-for-byte with the mobile app. Restyle everything around them; do not
   redefine them.
2. **Red means money at risk.** Never a brand accent, never decorative.
3. **Money is a decimal string, always.** Figures are rendered from strings and
   never parsed to a float — a BAS out by a cent is wrong. Any design that
   implies client-side arithmetic is undeliverable.
4. **Tabular numerals wherever a figure appears.** A number that shifts as it
   updates reads as untrustworthy, and this product's whole pitch is that the
   numbers are right.
5. **Nothing says "Soon".** No dead links, no placeholder that ships.
6. **Both themes, every time.** A surface legible only in light is half-built.
7. **No fabricated proof.** No invented testimonials, logos or user counts —
   fake testimonials breach Australian Consumer Law s29(1)(e)–(f) and s18, and
   on a compliance product one unverifiable claim discredits every real number.

---

## 4. Colour — light ("docket paper")

The grounds were blue until 2026-09-14. That meant the brand blue sat on a tint
of itself and stopped reading as an accent. They are now a faintly warm
off-white under a cool blue; that temperature contrast is doing the work.

| Token | Hex | Use |
|---|---|---|
| `ground` | `#FAF9F7` | Page background |
| `surface` | `#F2F0EC` | Recessed band, card fill |
| `surface-alt` | `#E7E4DE` | Pressed / secondary fill |
| `ink` | `#14181D` | Primary text |
| `ink-muted` | `#5A6068` | Body, secondary text |
| `ink-faint` | `#8D9299` | Labels, captions |
| `accent` | `#1878D8` | Brand blue — primary action |
| `accent-deep` | `#0060C0` | Hover / pressed |
| `accent-soft` | `#E4EEFA` | Tinted fill |
| `accent-ink` | `#FFFFFF` | Text on accent |
| `scan` | `#1CA8DB` | **Capture/extraction only** — the signature |
| `risk` | `#C4322A` | Money at risk |
| `risk-soft` | `#F8E7E5` | |
| `warn` | `#95590A` | |
| `warn-soft` | `#F7EEDC` | |
| `good` | `#1B6E4F` | Validated, balanced |
| `good-soft` | `#E2EFE9` | |
| `rule` | `#E2DFD8` | Hairline |
| `rule-strong` | `#C9C5BC` | Emphasised hairline, input border |
| `void` | `#101319` | The one inverted band |
| `void-ink` | `#F4F2EE` | Text on void |
| `void-muted` | `#8E949E` | |
| `void-rule` | `#2A2F38` | |

## 5. Colour — dark

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `ground` | `#0E1116` | | `risk` | `#F08B80` |
| `surface` | `#161A21` | | `risk-soft` | `#2C1A18` |
| `surface-alt` | `#1F242C` | | `warn` | `#E5B871` |
| `ink` | `#EDEBE7` | | `warn-soft` | `#2A2114` |
| `ink-muted` | `#9BA1A9` | | `good` | `#6FD3AC` |
| `ink-faint` | `#6C737C` | | `good-soft` | `#11241D` |
| `accent` | `#4DA3F5` | | `rule` | `#262B33` |
| `accent-deep` | `#1878D8` | | `rule-strong` | `#3A414B` |
| `accent-soft` | `#13243A` | | `void` | `#060809` |
| `accent-ink` | `#05101E` | | `void-ink` | `#EDEBE7` |
| `scan` | `#3FC6EE` | | `void-rule` | `#1E232A` |

---

## 6. Typography

**Archivo** (display + UI) and **IBM Plex Mono** (figures + labels),
self-hosted. Archivo is a highway-signage grotesque — it holds at 300 weight
set very large, which is the whole typographic move. Plex Mono carries every
figure, ATO label and receipt line; that is domain truth, not decoration — a
receipt really is printed in mono.

| Role | Size | Weight | Line-height | Tracking | Family |
|---|---|---|---|---|---|
| Display | `clamp(44px, 7.2vw, 92px)` | 300 | 1.02 | −0.035em | Archivo |
| Head | `clamp(28px, 3.4vw, 44px)` | 300 | 1.1 | −0.025em | Archivo |
| Sub | `clamp(18.4px, 1.9vw, 24px)` | 400 | 1.3 | −0.015em | Archivo |
| Lede | `clamp(16px, 1.25vw, 18px)` | 400 | 1.65 | — | Archivo |
| Body | 15px | 400 | 1.6 | — | Archivo |
| Small | 13.5px | 400 | 1.5 | — | Archivo |
| **Label** | **11px** | **500** | — | **0.18em, UPPERCASE** | **Plex Mono** |
| Figure | 13–40px contextual | 400 | 1 | — | Plex Mono, tabular |

The identity is the **contrast between two registers**: an airy 300-weight
headline against a tight, wide-tracked mono label. Do not bold the display
back to a SaaS default.

---

## 7. Space, radius, elevation

- **Spacing scale:** 4px base. Used: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, 96.
- **Radii:** sm `4px` · md `6px` · lg `10px` · xl `16px`. Deliberately tight —
  a 14px radius with a drop shadow made dense panels read as a pinboard.
- **Shadows** (used sparingly, mostly on hover):
  - card — `0 1px 2px rgb(20 24 29 / .04), 0 8px 24px -12px rgb(20 24 29 / .10)`
  - lift — `0 2px 4px rgb(20 24 29 / .05), 0 24px 48px -20px rgb(20 24 29 / .18)`
- **Separation is a hairline, not a box.** Prefer a 1px `rule` spanning the
  full measure over a bordered container.

---

## 8. Layout

- **Container:** max-width `1280px`, padding `24px` (mobile) / `40px` (≥768px).
  Reading measure `68ch`.
- **Breakpoints:** 640 / **768** / **1024** / 1280. The work happens at 768 and
  1024.
- **Marketing section:** vertical padding sm `48/56px` · md `56/80px` ·
  lg `64/96px` (mobile/desktop).
- **The section gutter:** at ≥1024px every marketing section is
  `120px | 1fr` with a `48px` gap. The 120px gutter holds a **sticky mono
  label carrying a real code** — `G11`, `1B`, `D1–D5`, `SUM = 0`, `FIRMS`.
  Those are actual ATO/BAS labels, not invented `01 / 02 / 03` markers. This is
  the single most characteristic structural device in the design.

---

## 9. Component anatomy

**Button** — radius 4px, weight 500, tracking 0.01em.

| Size | Height | Padding-x | Font |
|---|---|---|---|
| sm | 36px | 16px | 13px |
| md | 44px | 20px | 14px |
| lg | 56px | 32px | 15px |

- primary — `accent` fill, `accent-ink` text, hover `accent-deep`
- secondary — transparent, 1px `rule-strong` border, hover border → `ink`
- ghost — transparent, `ink-muted`, hover `ink`
- danger — `risk` fill, white text

**Input / Select** — 44px tall, radius 4px, 1px `rule-strong` border,
`ground` fill, 12px padding-x, 15px text, placeholder `ink-faint`.

**Card** (panels only, not marketing) — radius 6px, 1px `rule` border,
20px padding, no resting shadow.

**Badge** — label type (11px mono, 0.18em, uppercase), radius 4px,
8px × 4px padding, soft-tone fill.

**Ledger row** — the marketing workhorse, replacing cards:
`14px` code gutter (mono, 56px wide) · flexible label + optional note ·
right-locked mono figure. 16px vertical padding, 1px `rule` bottom border,
last row borderless.

**Table** (panels) — 13px, header 11px mono uppercase `ink-faint`, rows
divided by `rule`, 12px × 10px cells. Density is a feature here: an accountant
reviewing 200 documents wants rows, not cards.

**Focus** — 2px `accent` outline, 3px offset, everywhere. Never removed.

---

## 10. Motion (implemented, live)

Native CSS scroll timelines — `animation-timeline: view()` and `scroll()`. No
animation library ships. The rest state lives **inside**
`@supports (animation-timeline: view())`, so a browser without scroll timelines
gets the finished content rather than a blank page.

| Name | Behaviour | Range |
|---|---|---|
| rise | fade + 28px translate up | entry 5% → cover 32% |
| fade | opacity only | entry 0% → cover 25% |
| rule | hairline draws L→R (`scaleX`) | entry 10% → cover 30% |
| deal | staggered rows, `--i` index | entry 4%+7i → cover 26%+7i |
| drift | ±24px counter-scroll | full cover |
| wipe | `clip-path` uncover L→R | entry 15% → cover 45% |
| expand | 0.97 → 1 scale + opacity | entry 0% → cover 40% |
| progress | header rule, scroll-linked | document scroller |

Plus `.scan-line` — a 2px cyan sweep, **reserved for capture/extraction
imagery**. It is the signature, so it stops being one if it decorates a pricing
table.

`prefers-reduced-motion: reduce` disables all of it and the page stays fully
legible (verified: zero animated elements below 0.9 opacity at rest).

**If you add GSAP:** it earns its ~45 KB only for pinned scrubbed timelines,
horizontal-scroll sections and canvas frame sequences. Everything above is free
in CSS and works in Server Components.

---

## 11. Voice

- Sentence case. Plain verbs. No filler.
- **Real figures, never lorem.** Plausible AU amounts, real category names,
  correct ABN shape. The live site uses one coherent demo workspace throughout
  — *K. Marsh Transport*, `$18,409.91` captured, `$177.15` at risk — and the
  same numbers appear in the app screenshots. Keep any replacement equally
  consistent.
- **Worked examples must actually reconcile.** The hero docket's line items sum
  to its own splits. A balanced-books claim above arithmetic that doesn't
  balance is the worst possible own goal.
- Errors don't apologise and are never vague. An empty screen is an invitation
  to act.
- Avoid: gradient hero backgrounds, glass cards, emoji feature icons, three
  pricing cards with a "MOST POPULAR" ribbon, alternating tinted bands as the
  only structural device.

---

## 12. The brief — settled 2026-09-16

This section used to list six open questions. Five are now decided and one was
closed by a commit. The reasoning is kept because a decision without its reason
gets re-litigated by the next person to open this file.

### 12.1 The aesthetic — settled by the owner: OCR-futurist, done properly

**This overrides the recommendation that stood here earlier in the day.** That
draft read *"keep the paper, fix the rhythm — not a new palette, not glowing
chrome"* and treated the futurist register as the thing that had failed. The
owner's call is the opposite: the register was never the problem, the execution
was. The earlier reasoning is kept below because the *evidence* in it is still
true and still binding; only the conclusion changed.

**The diagnosis stands.** Three directions were built and all three were
rejected as generated-looking (`.design-directions/`: `FieldLight`,
`MachineVision`, `Main`). The rejection was not about colour. It was the *layout
metronome* — every section the same shape, one after another. The evidence is in
this repository: `apps/web/src/design/primitives/index.tsx` documents
`SectionHead` as the thing that *"replaces the eyebrow/title/lede stack that ran
identically seven times down the old home page"* — and the home page then ran
**eight sections, seven of them `Section → SectionHead → content`, tone
alternating `ground` / `surface`**. The fix had been applied at the level of the
component and the repetition simply moved up a level. §11 already lists
*"alternating tinted bands as the only structural device"* under **Avoid**.

**What "done properly" has to mean**, given the three other answers settled the
same day — purely typographic (§12.2), light default (§12.3), palette closed
(§12.5). Futurism here is a *register*, not a skin. It is carried by:

- **Instrument, not illustration.** The futurist feeling comes from the page
  behaving like a reading instrument — a real gutter carrying a real ATO code, a
  figure that locks to a column, a highlight that lands on the span it names.
  Not from anything that merely *depicts* technology.
- **Motion that reports.** Real motion is permitted and wanted, but every
  animation must be the system doing something — a box resolving onto a total, a
  ledger row settling — never ambient drift.
- **The palette stays.** §4–§5 is measured from the launch film and is shared
  byte-for-byte with `apps/mobile` (verified in `bafe7fb`). A futurist direction
  that starts by swapping to near-black plus a bright accent is the exact drift
  that produced two of the three rejected builds. If the palette ever changes it
  changes on both surfaces, as its own decision.
- **No glowing chrome.** §12.2 is not softened by this: no abstract gradients,
  no synthetic "AI" visuals, no decorative iconography. We have no art director
  and no commissioned photography, and substituting UI glow for imagery is
  precisely what read as slop.

The honest tension, stated once so it is not rediscovered: §12.2's constraint is
the hardest constraint under which to attempt a futurist direction, because it
removes every cheap signifier of one. That is deliberate. What is left —
typography, structure, motion, and the document itself — is the only version of
this that will not read as generated.

**The rule that replaces the metronome.** No two adjacent sections may share a
*form*. Tone alternation is not variation — it is the same shape in a different
colour. A page is built from at least four of these:

| Form | What it is | Use for |
|---|---|---|
| `head` | Rule, kicker, display line, lede | Opening a movement — **at most twice per page** |
| `ledger` | Rows against the gutter code, figures right-locked | Anything enumerable |
| `wide` | Full-bleed, no gutter, one idea at display size | The single most important claim |
| `measure` | One column at 68ch, no gutter, prose that earns its length | Explanation |
| `split` | Asymmetric 2-up, deliberately unequal (7/5, not 6/6) | Comparison, before/after |
| `inline` | No head at all — content starts immediately under a rule | Continuation of the section above |

The `120px | 1fr` gutter with a real ATO code (§8) stays as the spine, but the
gutter is not required on every section — `wide` and `measure` drop it on
purpose, and that absence is what makes the gutter read as a choice.

### 12.2 Art direction — settled: purely typographic

otsuka-air's restraint works because a real art director and real photography
carry it. **We have neither, and substituting glowing UI chrome for imagery is
precisely what read as slop in all three rejected directions.**

So: commit to a purely typographic direction. The only imagery permitted is
(a) the four real app screenshots already shipping and (b) the document itself —
a docket, a line, a figure. No abstract gradients, no synthetic "AI" visuals, no
decorative iconography. If a section needs a picture to work, it needs better
words.

This is a constraint, not a limitation: Archivo at 300 weight set very large
against a wide-tracked Plex Mono label is already a strong identity, and §6
calls that contrast "the whole typographic move."

### 12.3 Dark mode — settled: light is the default, dark is correct

The buyer is a tradie reading on a phone in direct sun, and an accountant
reading all day. **Neither is a dark-mode-by-default audience**, and two of the
three rejected directions went dark and immediately landed on the generated
near-black look.

Light default. Dark fully supported and tested, because §3.6 is not negotiable
and the OS setting must be honoured. The one inverted `void` band stays as an
accent — it works *because* it is the only one.

### 12.4 Proof — unchanged, and it is a hard rule

No product photography, no testimonials, no published accuracy number. The
accuracy metric reads `pending` **by design** and may not be quoted until it is
measured on real Australian paperwork against Hubdoc and Dext — see
`docs/GAPS.md` lanes B and E, which own that measurement.

Sample testimonials must stay visibly marked as samples or come out entirely.
§3.7 gives the legal reason; the commercial reason is that one unverifiable
claim discredits every real number on a compliance product.

### 12.5 Mobile palette — closed

Done in commit `bafe7fb`. `apps/mobile/src/theme/tokens.ts` now carries the web
values byte-for-byte (`ground #FAF9F7`, dark `#0E1116`). One palette, two
clients, as required. No further work.

### 12.6 Mechanism-led copy — open, and the largest remaining job

`/features` and `/how-it-works` describe the pipeline rather than the benefit.
`/how-it-works` is literally structured as the four internal layers —
*capture → extraction run → document → transaction* — which is `docs/PLAN.md`
§3's architecture diagram with prose around it.

**The reader does not have a pipeline problem. They have a Sunday problem, and
a "did I claim GST I'm not entitled to" problem.** Rewrite benefit-first: lead
with what the person gets, let the mechanism appear only where it is the reason
to believe.

### 12.7 The business flag — read this before designing any pricing surface

`apps/web/src/lib/features.ts` sets `BUSINESS_SURFACES_ENABLED = false`,
deliberately and reversibly, *"so the personal (sole-trader) experience can be
designed properly on its own."*

**This section's §2 describes the flag-on world.** With the flag off there is no
practice door, no Practice plans, no practices footer. `docs/ECOSYSTEM.md` D34
records the consequence: a visitor never learns the revenue channel exists.

**Design rule:** design the personal surfaces as the primary experience, and
keep every token, component and layout decision flag-safe — turning business
back on must be a content change, never a redesign. Do not build a layout that
only makes sense with one door, and do not build one that looks broken with two.


## 13. What is live right now

Home page rebuilt in the ledger language: hero with the price visible ·
per-category GST split · four real app screenshots · a named, date-stamped
capability comparison (Hubdoc / Dext / myDeductions / Ozly) · one inverted band
on the money-at-risk figure · deduction worksheet · practice review queue ·
pricing.

**Updated 2026-09-17 — the §12.1 register, built.** Two WebGL scenes ship on
`/`, and one on each of `/features` and `/how-it-works`:

- **The capture chamber** (hero) — a docket being read, with the extractor's
  field boxes latching onto the spans they name. The boxes are placed by
  `measureText` from the same code that drew the type, so they are exact by
  construction rather than by tuning.
- **The tax split** (G11) — the servo docket separating into its GST-free and
  taxable halves. The distance between the two sheets is the classification.

Both obey the island rule in `docs/WEB.md` §4.4: a server-rendered flat card is
the content, the canvas is a picture of it, and no figure exists only inside a
texture. First-load JS is unchanged on every marketing route.

The **metronome is gone** — the page no longer runs the same section shape
eight times with alternating tone. Forms: gutter · wide · gutter · measure ·
wide · gutter · wide. `.page-spine` replaces the tinted bands as the thing that
makes the page read as one document.

**Not yet done, and worth being plain about:** the register is carried by
depth, precision and the document itself, not by anything overtly sci-fi —
§12.2's purely-typographic constraint is still in force and still, as §12.1
says, the hardest constraint under which to attempt this. Scenes S3–S7 from the
build plan (the nine validators, the void band, the practice deck, the
comparison, the depth spine as a travelled Z-axis) are unbuilt. The scenes have
been verified against software rendering only, never a real mobile GPU.

Not yet redesigned: `/pricing`, `/docs/*`, `/support`, `/legal/*`, and the
signed-in panels at `/app/*` and `/admin/*` (those inherit tokens and the
flatter card, and are intentionally denser — *marketing breathes; panels
work*). `/features` and `/how-it-works` have the scenes but their copy is still
mechanism-led.
