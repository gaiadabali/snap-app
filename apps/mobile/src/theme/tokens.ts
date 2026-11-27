import { Platform, type TextStyle } from 'react-native';

/**
 * Sampled from "Snap Apps Prototype.dc.html" (redesign brief, 2026-09-19).
 *
 * REBRAND 2026-11-27 (owner request): the identity colour is now the official
 * Snap Apps orange, #EA542D, sampled from the owner's logo ("Snap apps.png").
 * It replaces the launch-film blue (#1878D8) everywhere. What that forced:
 *
 *   - `accent` is the brand fill. Per the GOD Ecosystem Brand Guidelines (p20)
 *     INK on orange is 4.9:1 (AA, all text) while white on it is 3.6:1 (large
 *     text only), so every label on an orange fill is `accentInk` = Ink
 *     #0F172A, never white. Orange itself is never body text on Paper (3.3:1);
 *     orange text uses `accentText`, a darker orange derived from the brand
 *     hue (#B2300F, 5.8:1 on Paper).
 *   - the neutrals are the guide's: Ink #0F172A, Slate #5B6375, Mist #E4E3DC,
 *     Paper #F6F5F0, Orange tint #FBE0D9. The dark scheme is ours (the guide
 *     defines none): Ink-derived navy-slates.
 *   - `risk` moved from #C4322A to a crimson (#B3123F) and `warn` from #95590A
 *     to a golden brown (#8A6100): the old values sat one step from orange.
 *   - `scan` is a warm apricot now, not cyan.
 *
 * (Earlier history, kept for the record: the identity colours were the
 * measured ones from the launch film, `accent` #1878D8, `scan` #1CA8DB.)
 *
 * The NEUTRALS did move, and the move is deliberate rather than drift. History,
 * so nobody re-litigates it from half the story:
 *
 *   - through 2026-09-14 this file ran blue-tinted greys of its own;
 *   - on 2026-09-14 it was switched to `apps/web`'s warm "docket paper" set
 *     (ground #FAF9F7, surface #F2F0EC …) so the two clients shared one
 *     background — see docs/DESIGN-HANDOFF.md §4/§5/§12.5;
 *   - the 2026-09-19 redesign moves mobile to a COOL blue-grey set
 *     (ground #F7F9FC, surface #EAF0F8 …), which is the prototype's own
 *     palette, sampled byte for byte below.
 *
 * So mobile and web are once again on different neutrals — on purpose this
 * time, and only on the neutrals. If web is meant to follow, the values to
 * copy are `ground`/`surface`/`surfaceAlt`/`ink`/`inkMuted`/`rule`/`ruleStrong`
 * and nothing else. Until then, treat a "why don't these match?" report as
 * expected rather than a bug.
 */

export type Scheme = 'light' | 'dark';

/** Declared explicitly: `as const` on one scheme would make its hex values
 *  literal types and the other scheme unassignable to it. */
export interface Palette {
  ground: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  /** Between `ink` and `inkMuted`. The prototype's `--ink2`. */
  inkStrong: string;
  inkMuted: string;
  inkFaint: string;
  /** Brand fill (#EA542D). Icons, borders, indicators, the logo. White on it is
   *  3.62:1: never put body text on it, use `accentStrong`. */
  accent: string;
  /** Accent as TEXT or as a tinted icon — `accent` itself is too dark on a
   *  dark ground and too light on a light one to read at body size. */
  accentText: string;
  accentSoft: string;
  accentInk: string;
  /** Cyan from the teaser's scan line. Capture/extraction UI only. */
  scan: string;
  risk: string;
  riskSoft: string;
  /** Text sitting *inside* a `riskSoft` fill. */
  riskInk: string;
  riskRule: string;
  warn: string;
  warnSoft: string;
  warnInk: string;
  /** Validated, balanced — a positive that is not the brand accent. */
  good: string;
  goodSoft: string;
  goodInk: string;
  info: string;
  infoSoft: string;
  rule: string;
  ruleStrong: string;
  overlay: string;
  /** The phone's own status bar in the prototype frame. */
  chrome: string;
  /**
   * A card's own fill — white on the light ground, a lifted grey on the dark.
   * Added in the premium pass (2026-10-19): the prototype filled cards with
   * `surface`, a pale blue only ~3% off the ground, so in grayscale the cards
   * all but vanished and a screen read as one flat sheet. A white card with a
   * soft shadow is the phone-app convention, and it matches the floating bar.
   */
  card: string;
  /** The hairline a card carries where a shadow cannot be seen (dark mode). */
  cardEdge: string;
}

const light: Palette = {
  ground: '#F6F5F0',
  surface: '#EFEEE8',
  surfaceAlt: '#E4E3DC',
  ink: '#0F172A',
  inkStrong: '#3B4256',
  inkMuted: '#5B6375',
  inkFaint: '#656C7C',
  accent: '#EA542D',
  accentText: '#B2300F',
  accentSoft: 'rgba(234,84,45,0.18)',
  accentInk: '#0F172A',
  scan: '#E8801F',
  risk: '#B3123F',
  riskSoft: '#FBE6EC',
  riskInk: '#7E0F2D',
  riskRule: '#E8B8C6',
  warn: '#8A6100',
  warnSoft: '#F8F0D6',
  warnInk: '#4F3700',
  good: '#1B6E4F',
  goodSoft: '#E2EFE9',
  goodInk: '#12452F',
  info: '#14507F',
  infoSoft: '#E4EEF9',
  rule: '#E4E3DC',
  ruleStrong: '#CFCEC5',
  overlay: 'rgba(15,23,42,0.55)',
  chrome: '#F6F5F0',
  card: '#FFFFFF',
  cardEdge: 'rgba(15,23,42,0.05)',
};

const dark: Palette = {
  ground: '#0E1320',
  surface: '#161C2B',
  surfaceAlt: '#202739',
  ink: '#F6F5F0',
  inkStrong: '#D5D8E0',
  inkMuted: '#A4ABBB',
  inkFaint: '#7F8799',
  accent: '#EA542D',
  accentText: '#FF8A66',
  accentSoft: 'rgba(255,138,102,0.16)',
  accentInk: '#0F172A',
  scan: '#FFB27A',
  risk: '#F58AA5',
  riskSoft: '#34161F',
  riskInk: '#F9C6D3',
  riskRule: '#5E2A3A',
  warn: '#E8C25C',
  warnSoft: '#2E2617',
  warnInk: '#F3E2B0',
  good: '#6FD3AC',
  goodSoft: '#182C23',
  goodInk: '#BCE7D2',
  info: '#C4DDF7',
  infoSoft: '#16283A',
  rule: '#262D3E',
  ruleStrong: '#353D52',
  overlay: 'rgba(5,8,16,0.72)',
  chrome: '#0E1320',
  card: '#161C2B',
  cardEdge: 'rgba(255,255,255,0.06)',
};

export const palettes: Record<Scheme, Palette> = { light, dark };

/**
 * The hero card gradient — sign-in, the credits balance, the plan card.
 * Three stops, 135°. Consumed by `<Hero>` in components/ui.tsx.
 */
export const heroGradient = {
  colors: ['#C43512', '#D13A14', '#9E2E0F'] as const,
  locations: [0, 0.52, 1] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

/**
 * Category colours. `hue` is the fill or dot; `ink` is the same hue pushed to
 * a readable text weight against the scheme's ground. Unknown categories hash
 * onto the list rather than falling back to grey, so a user-made category
 * still looks deliberate.
 */
export const categoryHues: Record<string, string> = {
  Groceries: '#3BA55C',
  'Eating out': '#F2994A',
  Transport: '#5B6EF5',
  'Bills & utilities': '#6C8AE4',
  Health: '#EF6C7E',
  Shopping: '#9B6BF2',
  'Home & garden': '#1CA8DB',
};

const categoryInk: Record<Scheme, Record<string, string>> = {
  light: {
    Groceries: '#2C7C45',
    'Eating out': '#9A5A12',
    Transport: '#4453C9',
    'Bills & utilities': '#4A64B8',
    Health: '#B8384C',
    Shopping: '#7A46D8',
    'Home & garden': '#116C8C',
  },
  dark: {
    Groceries: '#6FD3AC',
    'Eating out': '#E8B45C',
    Transport: '#93A3F8',
    'Bills & utilities': '#9DB4F0',
    Health: '#F59BAB',
    Shopping: '#B79BF0',
    'Home & garden': '#6ACBEB',
  },
};

const hueList = Object.values(categoryHues);

/** Stable colour for any category name, invented or seeded. */
export function hueFor(category: string, scheme: Scheme = 'light'): { hue: string; ink: string } {
  const known = categoryHues[category];
  if (known) return { hue: known, ink: categoryInk[scheme][category] ?? known };

  // Same hash the prototype uses, so a category keeps its colour across clients.
  let h = 0;
  for (let i = 0; i < category.length; i += 1) h = (h * 31 + category.charCodeAt(i)) % 997;
  const name = Object.keys(categoryHues)[h % hueList.length];
  return { hue: categoryHues[name], ink: categoryInk[scheme][name] };
}

/** 4pt base scale. */
export const space = {
  /** The screen's side margin. 20, not 16: the premium pass's first rule was
   *  more room, and the edge is where a cramped screen shows it first. */
  gutter: 20,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  /** Chips and the smallest tiles. */
  sm: 8,
  /** Inputs, buttons, icon tiles — the workhorse. */
  md: 12,
  /** Notices and popovers. */
  lg: 14,
  /** Cards. */
  xl: 18,
  /** Hero cards. */
  xxl: 20,
  /** The top corners of a bottom sheet. */
  sheet: 24,
  pill: 999,
} as const;

/**
 * Control heights. The prototype is consistent about these and they carry most
 * of its feel, so they are tokens rather than numbers typed per screen.
 * `tap` is the floor for anything pressable — it is the accessibility minimum,
 * not a style choice.
 */
export const control = {
  tap: 44,
  input: 52,
  button: 52,
  /** The amount field, which is taller than a plain input. */
  amount: 56,
  tabItem: 60,
} as const;

/**
 * Geist, since the premium pass (2026-10-19) — see `theme/text.tsx`, which
 * resolves each weight to its face. The type tokens below name no family:
 * anything without one is set in Geist.
 *
 * The old rule here was "system fonts on purpose: a custom face can fail to
 * load five minutes before a demo". The faces are bundled with the app and
 * loaded before the first frame, and if loading ever does fail the resolver
 * falls back to the system font — so that failure is now cosmetic, not fatal.
 */
export const font = {
  body: 'Geist',
  /**
   * Audiowide, the Snap Apps brand face (GOD Ecosystem Brand Guidelines p16).
   * One weight, wide and display-sized, so it is for the brand voice only: the
   * splash, the sign-in hero and screen titles. Everything you read or type
   * stays in Geist. Registered in `theme/text.tsx` under this name.
   */
  brand: 'Audiowide_400Regular',
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export const type = {
  /** Splash only. */
  splash: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -1 },
  /** The number a screen exists to show — a balance, a total. Geist runs
   *  wide at display sizes, so the big steps carry negative tracking. */
  hero: { fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -1.2 },
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.9 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.6 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  /** A section's heading on the page — "Latest", "Per category". Bigger and
   *  darker than the 12pt grey eyebrow the prototype used, which made every
   *  section start with the same whisper. */
  section: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  /** Figures inside a card — an amount field, a per-row total. */
  figure: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  /** Text typed into an input. 16px or iOS zooms the field on focus. */
  input: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  smallStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  tiny: { fontSize: 11, lineHeight: 15, fontWeight: '400' },
  /** Tab bar captions. */
  tab: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  /** Section eyebrows. Sentence case in the redesign — the old all-caps
   *  tracking is gone, so this no longer sets `textTransform`. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
} as const;

/** Spread into a Text style to set it in Audiowide. `fontWeight: 'normal'`
 *  because the face has one weight and anything else would be synthesised. */
export const brandFace = { fontFamily: font.brand, fontWeight: 'normal' } as const;

/** Figures that line up in columns. Money should always use this.
 *  Not `as const`: RN's TextStyle wants a mutable FontVariant[]. */
export const numeric: { fontVariant: TextStyle['fontVariant'] } = {
  fontVariant: ['tabular-nums'],
};

/**
 * Elevation. Two layers each — a tight shadow for a crisp edge and a wide
 * soft one for lift — because a single blurred shadow reads as a smudge.
 * Light mode only: on a dark ground a shadow is invisible, so dark cards
 * separate by their lighter fill and a hairline instead.
 */
export const shadow = {
  /** Cards and list groups sitting on the page. */
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  /** The hero and anything that should feel lifted off the page. */
  lift: {
    shadowColor: '#9E2E0F',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const;
