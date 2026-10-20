# The marketing kit — `src/design/site`

The 2026-10 redesign turned snap-apps.gaiada.com into an **app's website**: it
shows the phone app, in the app's own type (Geist) and the app's own surfaces
(white raised cards on a cool ground, the blue gradient hero card, a floating
bar). The earlier "ledger" register — hairlines, mono gutter codes, one pinned
screen per section — is retired on marketing pages. Panels (`/app/*`,
`/admin/*`) do not use this kit and keep `globals.css` + `design/primitives`.

This file is the contract. Several people build sections in parallel on it.

## Files

| File | What | Who edits |
|---|---|---|
| `site.css` | Tokens (`--s-*` site, `--a-*` app), type, buttons, surfaces, phone frame, reveal, hero sequence | Owner only |
| `index.tsx` | Server components: `Shell`, `Reveal`, `SectionHead`, `Btn`, `StoreButtons`, `Assurances`, `Phone`, `Chip`, `IconTile`, `TextLink`, `aud()`, `ILLUSTRATIVE_NOTE` | Owner only |
| `client.tsx` | Client islands: `CountUp` | Owner only |
| `app-ui.tsx` | The phone app drawn in code: screens + building blocks | Owner only |
| `icons.tsx` | `Icon` (one stroke set) and `SnapMark` (the app icon) | Owner only |
| `demo.ts` | **Every figure on the site.** One household, one October | Owner only — `demo.test.ts` proves it adds up |

Need something the kit does not have? Build it in **your own file** next to
your section. Do not edit the kit; say what you needed in your report.

## Tokens — never hard-code a colour

Use the CSS variables, which carry light, dark, and the night register:

- Ground and surfaces: `--s-bg`, `--s-mist`, `--s-mist-2`, `--s-card`, `--s-edge`, `--s-edge-2`
- Ink, strongest to faintest: `--s-ink`, `--s-ink-2`, `--s-ink-3`, `--s-ink-4`
- Brand: `--s-blue`, `--s-blue-2`, `--s-blue-deep`, `--s-blue-text` (blue as TEXT), `--s-blue-soft` (tint fill), `--s-cyan` (scan line only)
- Meaning: `--s-green` / `--s-green-soft` (valid, GST-free), `--s-red` / `--s-red-soft` (**money at risk only**), `--s-amber` / `--s-amber-soft`
- Gradients: `--s-grad` (the app's hero card), `--s-grad-bright` (primary button)
- Shadows: `--s-shadow-1/2/3`; easing: `--s-ease`, `--s-spring`

Tailwind: `text-[var(--s-ink-3)]`, `bg-[var(--s-mist)]`. Inside `.night` every
`--s-*` token is remapped to its dark value, so the same classes work there.

## Classes (`site.css`)

| Class | Use |
|---|---|
| `shell` / `shell-narrow` | Page width (1240 / 880) with gutters |
| `section` / `section-tight` | Vertical rhythm for a section |
| `hd-hero` `hd-1` `hd-2` `hd-3` `hd-4` | Headings. One `hd-hero` per page (the h1). **Never `h-1`…`h-4`** — those are Tailwind HEIGHT utilities |
| `lede` `body` `small` | Copy |
| `kicker` | Small blue label above a heading. **Not on every section** |
| `chip` (+ `chip-dot`) | Small rounded pill |
| `ink-grad` | Brand gradient in type — **one phrase per page at most** |
| `btn` + `btn-primary` / `btn-secondary` / `btn-ghost` / `btn-light` / `btn-glass`, `btn-lg` / `btn-sm` | Buttons (prefer `<Btn>`) |
| `card`, `card-mist`, `card-hover`, `band-mist` | Surfaces |
| `night` (+ `grain`) | The dark register. Dark in both themes. **One per page, at most two** |
| `horizon` | Soft blue light behind a phone (absolutely positioned, give it size) |
| `dots` | Faded dot grid behind a hero |
| `tilt` / `tilt-r` | A phone held at an angle |
| `paper` | A torn-edge paper receipt (see `DocketPaper`) |
| `float-card` | A glassy fact card floating near a phone |
| `faq` | On a `<details>`: animated FAQ item (`.faq-icon` rotates when open) |
| `parallax` / `parallax-slow` | Scroll-driven drift. Movement only |
| `mask-fade-b`, `mask-fade-x`, `no-scrollbar` | Utilities |

Component rules sit in `@layer components`, below Tailwind utilities, so a
utility on a kit element wins (`max-sm:hidden` on a `.float-card` works).

## Motion — the rules that keep pages from going blank

1. **Reveal with `<Reveal>`** (or `data-reveal` / `data-stagger` +
   `suppressHydrationWarning`). Variants: `up` (default), `fade`, `scale`,
   `left`, `right`, `blur`; `delay` in 80ms steps; `stagger` reveals direct
   children in turn. The inline script in `app/layout.tsx` adds
   `html.motion` and sets `data-in` on first sight. **No JS, reduced motion,
   or a script error = everything visible.**
2. **Never write CSS that hides content unless it is gated by `.motion`** and
   un-hidden by `[data-in]`. Your own keyframes must END on the visible state.
3. Inside a revealed block: `.grow-x` (bars), `.grow-y` (columns, `--i`
   staggers), `.ring-draw` with `--p` (SVG rings) animate to their value.
4. **No infinite loops** longer than five seconds without a pause control
   (WCAG 2.2.2). Prefer play-once.
5. Client islands only where state is needed. Keep them small; the page stays
   a Server Component. Use `IntersectionObserver`, never scroll listeners
   doing layout reads.
6. Respect `prefers-reduced-motion: reduce` in any client island.

## The phone

```tsx
<Phone className="[--pw:280] lg:[--pw:320]"><HomeScreen /></Phone>
```

Screens render at the app's 390 × 876 points and are zoomed to the frame.
Ready screens in `app-ui.tsx`: `HomeScreen`, `CaptureScreen` (`animated`),
`ReceiptScreen` (`popIn`), `FindingScreen`, `ReceiptsScreen`,
`AnalyticsScreen`, `BudgetsScreen`, `GoalsScreen`, `RecurringScreen`,
`CreditsScreen`, `HouseholdScreen`. Build new ones in your own file from
`AppScreen` (`tab`, `scheme="dark"`), `AppBody`, `AppTitleBar`,
`AppSectionTitle`, `AppBar`, `AppRing`, `AppDonut`, `CatIcon`, `DocketPaper`,
and the `--a-*` tokens + `.app-card` / `.app-hero` classes. Author in app
points: `text-[15px]`, `rounded-[20px]`.

A phone is a **picture** (`aria-hidden`). Anything a reader needs from it must
also be in the page as text.

## Content rules — these are legal and honesty rules, not taste

- **Sell what ships.** The app is the *personal release* (docs/ECOSYSTEM.md
  D34). It does: capture (offline-safe), per-line reading, GST-free vs taxable
  split, tax-invoice and ABN checks with a suggested fix, five-year true-copy
  record keeping, spending and analytics, budgets, recurring, savings goals,
  household sharing, CSV export, credits. It does **not** show in the app
  today: BAS reports, the tax pack, deduction estimates, invoices, bills,
  mileage, Xero sync, practices. Those may appear only behind
  `BUSINESS_SURFACES_ENABLED` from `@/lib/features`.
- **Figures come from `demo.ts`**; prices from
  `app/(marketing)/pricing/credit-packs.ts` (`FREE_SCANS_AT_SIGNUP`,
  `CREDIT_PRICE_AUD`, `CREDIT_PACKS`). Never type a price or a free-scan
  count yourself — `free-scans.test.ts` scans the source for it.
- **No social proof we do not have**: no testimonials, star ratings, user
  counts, "trusted by" logos, press quotes. ACL s18/s29 — see docs/WEB.md §4.5.
- **No accuracy claims** ("99% accurate") and no quality claims against named
  competitors. Capability claims ("reads each line") are fine.
- **iPhone is not installable.** Say "in development". Never "coming soon",
  never a date.
- Do not claim where data is hosted (the privacy page owns that wording).
- Australian English: colour, organise, licence (noun). Words people use:
  docket, receipt, tax invoice, tradie, servo, ute, GST, ABN, ATO.

## Voice

Plain, specific, a little dry. Short sentences. A number beats an adjective.
**Banned:** unlock, seamless(ly), effortless(ly), revolutionise, supercharge,
elevate, empower, game-changer, "say goodbye to", "in today's world",
emoji, exclamation marks.

## What reads as a template — avoid

- A kicker + centred title + lede + three identical icon cards, section after
  section. **Vary the silhouette**: if two neighbouring sections share a
  shape, change one.
- Purple/indigo gradients, glassmorphism everywhere, floating blobs.
- Every heading bold-and-centred; every section the same height.
- Decoration with no job: motion should show state changing or reward the
  scroll.

## Accessibility

One `h1` per page, then `h2` per section, in order. Real buttons and links;
interactive islands keyboard-operable with visible focus. Decorative SVG is
`aria-hidden`. Colour is never the only signal (pair green/red with a word).
Both themes legible.
