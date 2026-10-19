# Snap Apps mobile — the instrument pass

**Status:** built 2026-10-19 on `feat/mobile-ui-premium`.
**Who decided what.** The *brief* is the owner's, given that day: *"a major UI
update — no AI slop, a premium mobile app, top-level UI and UX for this kind of
app, not overboard but a proper high-tech app."* The *register* is the owner's
earlier ruling for web, DESIGN-HANDOFF.md §12.1 (OCR-futurist, done properly;
typographic; palette closed). **Everything below that turns those two into
specific tokens, components and layouts is Claude's proposal, implemented** —
not a settled decision. Treat it as a first cut the owner has not yet reviewed.

This is the contract every mobile screen is built against. Read it before
touching a screen. The reference implementation is
`src/components/home/PersonalHome.tsx` with `src/components/home/shared.tsx`.

---

## 1. What was wrong, in one paragraph

The 2026-09-19 prototype build was the generated-fintech template: a three-stop
blue gradient hero with two translucent circles floating in it, a pastel
rounded icon tile at the head of every row, eighteen-point cards stacked one
under another with drop shadows, four round tinted shortcut buttons, a donut
chart, and bold system type on everything. None of it was wrong alone. Together
it is the *layout metronome* §12.1 names — every block the same rounded shape —
and the owner called it slop.

## 2. The register

**An instrument, not an illustration.** The phone should feel like a precise
reading device for money: a figure set large and light, values in mono that
lock to a column, hairlines where the prototype had boxes, and motion only when
the system has done something.

Three moves carry it, and they are the whole design:

1. **Two registers of type.** Archivo (light at display sizes) for language;
   IBM Plex Mono for values and labels. The same two web uses.
2. **Structure is a hairline, not a box.** Lists are ledger rows on the ground
   under a mono label. Cards survive only where a group needs an edge.
3. **One dark panel per screen.** The `void` panel carries the figure the screen
   exists to show. It works because it is the only dark thing on a light page.

## 3. Tokens (`src/theme/tokens.ts`)

**Colour is unchanged.** Every hex is the pre-pass value; identity colours are
measured and shared with web (§3.1, §12.5). Added from web's palette: `void`,
`voidInk`, `voidMuted`, `voidRule`, `accentDeep`. Content on the void panel
takes `onVoid.*` (fixed light-on-dark hues), never `p.risk` etc.

| Rule | Detail |
|---|---|
| Red | Money at risk only. An unread badge is `accent`, not red. |
| Cyan `scan` | Capture/extraction only. The Scan key turns cyan on the camera. |
| Category hues | Encoding only: swatches, bars, the category mark. Never fills. |
| Gradients | None. `expo-linear-gradient` is no longer used for chrome. |
| Shadows | Only on things that float (sheet, menu panel): `elevation.float`. |

**Type** — use `type.*`, never a raw size/weight pair:

| Token | Face | Use |
|---|---|---|
| `hero` 52/56 | Archivo 300 | The panel figure |
| `display` 34/40 | Archivo 300 | A tab root's title |
| `h1` 26/32 | Archivo 400 | A pushed screen's title (`ScreenHeader`) |
| `h2` 20/26, `h3` 17/22 | Archivo 500 | Sheet titles, sub-heads |
| `body` / `bodyStrong` 15 | Archivo 400 / 500 | Text; a row's title is `bodyStrong` |
| `small` / `smallStrong` 13 | Archivo 400 / 500 | Notes, captions |
| `amount` 15 | Plex Mono 400 | Any amount in a row or column |
| `figure` 20 | Plex Mono 400 | A larger in-card figure |
| `mono` 12 | Plex Mono 400 | Dates in a gutter, counts, percentages |
| `label` 11, +1.4 tracking, UPPER | Plex Mono 500 | Names a value or a group |
| `tab` 10 | Plex Mono 500 | Tab bar captions |

Nothing is heavier than 600. A `fontWeight: '700'` written on a screen resolves
to SemiBold — do not write it in new code.

**`Text` and `TextInput` come from `@/theme/text`, never from `react-native`.**
The resolver there maps (family, weight) to the bundled face. A Text imported
from react-native silently renders in the system font.

**Radius:** `xs 4` badges · `sm 6` chips/segments · `md 10` buttons, inputs,
tiles · `xl 12` cards · `xxl 16` the void panel · `sheet 20`.

**Motion** (`motion.*`, `src/components/motion.tsx`): `PressableScale` (3% give
plus a haptic tick), `Settle` (a figure arriving glyph by glyph — it animates
the *string*, never counts a number up), `useFill` (a meter drawing to a measured
value). All honour reduce-motion. Nothing loops, drifts or pulses.

## 4. Components

From `src/components/ui.tsx` unless noted.

| Component | Use it for |
|---|---|
| `Section label action? rule?` | A group on the page: mono label, optional right-hand action, hairline. Replaces "Label above a Card". |
| `LedgerRow gutter? lead? title note? figure? trailing? onPress? first?` | Every list row of things with amounts or dates. `gutter` is ≤6 mono chars ("16 SEP"); `first` drops the top hairline. |
| `Row` | Settings-style navigation rows (icon, title, subtitle, chevron). Icon tile is an outline. |
| `Segmented options value onChange` | One choice from 2–4 always-visible options (periods, ranges). |
| `Chip` | No `onPress` → mono status badge ("CHECK", "PAID"). With `onPress` → filter chip (outline, ink when selected). |
| `Card tone? bordered?` | A group that needs an edge: a form, a choice, a summary. Surface fill + hairline. **Not** for lists. |
| `Notice tone` | Inline message with a 2px tone edge. |
| `Button tone` | `accent` (one primary per screen), `outline`, `ghost`, `risk`. |
| `ScreenHeader title onBack trailing` | Pushed screens: back arrow on its own line, then the title in `h1`. |
| `ProgressBar value marker? track?` | Meters. 4px default; draws in. |
| `GradientHero` / `Instrument` (`rich.tsx`) | The void panel. One per screen, at the top, carrying the headline figure. `HeroLabel`, `HeroFigure settle`, `HeroBody` inside it. |
| `Tile` (`rich.tsx`) | A readout: hairline above, mono label, light figure. Two side by side read as one instrument. |
| `CategoryIcon`, `CategorySwatch` (`rich.tsx`) | A category's mark / colour square. |
| `Keypad` (`home/shared.tsx`) | A strip of 3–4 shortcut keys divided by hairlines. |
| `Field`, `Choice`, `Toggle`, `Sheet`, `AddButton`, `Empty`, `Avatar` (`form.tsx`) | Forms, already restyled. |

## 5. Screen anatomy

- **Tab root:** chrome row or `display` title → the void panel → content in
  forms that differ from each other (readout pair, keypad, section + ledger).
- **Pushed screen:** `ScreenHeader` → optional void panel → sections of ledger
  rows → a single primary `Button` pinned or at the end.
- **Gutters** 16pt (`space.lg`) left and right. Sections are separated by
  `space.xxl` (32), not by cards.
- **No two consecutive blocks share a shape.** If a screen is "card, card,
  card", turn at least two of them into sections of rows or a readout.
- **Empty states** say what to do next, never "No data". Live data is often
  empty (a new account in a new month) — design that state first.

## 6. The don't-list (each one is a tell this pass removed)

- A tinted icon tile at the head of every row. (Outline, or no icon.)
- A gradient, a glow, a blur circle, a glass card.
- A card per item in a list. (Ledger rows.)
- A drop shadow on anything that sits on the page.
- A label over every section — a `Section` label names a group; a screen with
  six of them in a row is back to the metronome.
- Bold everywhere. One `bodyStrong` per row at most.
- Pill-shaped everything. Pills only for the sheet handle.
- Emoji as icons, decorative illustrations, a "✨ AI" anything.
- Money parsed to a float for display. Format the API's string; compare with
  `Number()` only to choose a tone.

## 7. Verifying

The owner's machine runs several projects at once: **do not run the Metro dev
server or a local web export to check a screen.** Typecheck (`pnpm --filter
@snap/mobile typecheck`) and the unit tests are the local gate. Visual
verification happens on the deployed review build at
`https://snap-apps-app.gaiada.com/` (sign in with a demo account), in both light
and dark.
