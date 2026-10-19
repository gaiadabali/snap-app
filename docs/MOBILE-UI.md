# Snap Apps mobile — the premium pass

**Owner's rulings (2026-10-19), in his words:** a major UI update — *"no AI
slop … premium mobile app … not too overboard but a proper high tech app"*;
then, rejecting a pass that copied the website: *"dont make it like the website.
that website is still too ugly. Revert and upgrade"*, with floating tab bars and
a prominent middle button as the reference, and *"ensure the bottom nav always
in every pages"*.

**Baseline:** the owner's own 2026-09-19 prototype — system of rounded cards,
brand gradient hero, tinted category icons. This pass UPGRADES that; it does
not replace it with a different register. Everything below that turns the
rulings into specific values is Claude's proposal, built and shown on live, not
yet approved line by line.

Reference implementation: `src/components/home/PersonalHome.tsx` and
`src/components/home/shared.tsx`. The bar is `src/components/BottomNav.tsx`.

## The rules

Measured against Refactoring UI's diagnostic, the prototype scored ~5/10: flat
(cards ~3% off the ground), cramped (the same 15pt inside and between groups),
off-scale spacing, nothing elevated. Each rule fixes one of those.

1. **Side margin is `space.gutter` (20).** Card inner padding 16–20.
2. **Rhythm:** `space.xl` (24) between blocks; `space.md` (12) between a
   section's heading and its content; 8 inside a group. Between-group spacing
   must beat within-group spacing.
3. **Section headings are `SectionHeader`** (17pt semibold, ink, optional
   action on the right: "See all", "Edit"). `Label` (12pt grey) is only for
   small captions INSIDE a card — a metric's name, a field's name.
4. **A card is WHITE and lifted:** `Card` / `Raised` (or `p.card` with
   `shadow.card` in light, `cardEdge` hairline in dark). `p.surface` and
   `p.surfaceAlt` are for RECESSED things only — input and search fills,
   chip and segmented tracks, progress tracks.
5. **Selectable tiles** (top-up packs, choices): a white card; selected adds a
   2px `accent` border and `accentText` figure. Never a pastel fill as the only
   difference.
6. **Lists:** rows inside one white card, divided by an inset hairline — the
   prototype's pattern, kept.
7. **One primary button per screen** (accent, which lifts on its own); the rest
   outline or ghost.
8. **Spacing values come from the scale:** 4, 8, 12, 16, 20, 24, 32, 48. No 13,
   15, 22.
9. **Type comes from `type.*`.** Geist is applied by `@/theme/text`; always
   import `Text`/`TextInput` from there.

## Not this

Nothing from the reverted web-style pass: no uppercase mono labels, no black
"void" panels, no hairline-only ledger pages, no IBM Plex Mono. No new colours
outside the palette and category hues; red is money at risk only.

## Verifying

Don't run Metro or a local web export — the owner's machine runs several
projects. Typecheck locally; look at it on https://snap-apps-app.gaiada.com/
(demo accounts on the sign-in screen), light and dark.
