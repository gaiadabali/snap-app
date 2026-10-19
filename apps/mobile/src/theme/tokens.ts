import { Easing, type TextStyle } from 'react-native';

/**
 * The mobile design tokens — the "instrument" pass, 2026-10-19.
 *
 * WHAT CHANGED AND WHAT DID NOT. The colours are untouched: every hex below
 * is the value that was here before this pass, and the identity colours —
 * `accent` #1878D8, `scan` #1CA8DB, the risk/warn/good hues — are still the
 * ones measured from the launch film and shared with `apps/web`
 * (docs/DESIGN-HANDOFF.md §3.1, §12.5). What moved is everything AROUND the
 * colour: the type, the radii, the elevation, and the four `void` entries
 * mobile was missing from web's palette.
 *
 * Why the pass happened, in one line: the 2026-09-19 prototype build read as
 * a template — a gradient hero with two decorative blur circles, a pastel
 * icon tile at the head of every row, eighteen-point cards stacked one under
 * another, bold system type on everything. That is the layout metronome
 * DESIGN-HANDOFF.md §12.1 names as the slop tell, on a phone instead of a
 * page. The fix is the same one web made: carry the register in type,
 * structure and motion that reports, not in chrome.
 *
 * Neutrals history, kept so nobody re-litigates it from half the story:
 * blue-tinted greys until 2026-09-14; web's warm docket paper until
 * 2026-09-19; the cool set below since, which web then adopted too. One
 * palette, two clients — neither changes a neutral alone.
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
  /** Brand fill. White sits on this in both schemes, so it does not theme. */
  accent: string;
  /** The pressed state of an `accent` fill. Web's `accent-deep`. */
  accentDeep: string;
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
   * The inverted panel — web's `void` band, brought across in this pass.
   *
   * One per screen, carrying the figure the screen exists to show. It works
   * BECAUSE it is the only dark thing on a light page (§12.3), which is why
   * it is never used for a second card further down. Content on it takes its
   * colours from `onVoid`, not from the palette, since the panel is dark in
   * both schemes.
   */
  void: string;
  voidInk: string;
  voidMuted: string;
  voidRule: string;
}

const light: Palette = {
  ground: '#F7F9FC',
  surface: '#EAF0F8',
  surfaceAlt: '#DCE5F2',
  ink: '#14181D',
  inkStrong: '#3F464E',
  inkMuted: '#5A6068',
  inkFaint: '#858B93',
  accent: '#1878D8',
  accentDeep: '#0060C0',
  accentText: '#0F5BB5',
  accentSoft: 'rgba(24,120,216,0.13)',
  accentInk: '#FFFFFF',
  scan: '#1CA8DB',
  risk: '#C4322A',
  riskSoft: '#F8E7E5',
  riskInk: '#8A2A22',
  riskRule: '#E0BCB8',
  warn: '#95590A',
  warnSoft: '#F7EEDC',
  warnInk: '#5A2F05',
  good: '#1B6E4F',
  goodSoft: '#E2EFE9',
  goodInk: '#12452F',
  info: '#14507F',
  infoSoft: '#E4EEF9',
  rule: '#DCE3EE',
  ruleStrong: '#C2CEDF',
  overlay: 'rgba(20,24,29,0.55)',
  chrome: '#FAF9F7',
  void: '#101319',
  voidInk: '#F4F2EE',
  voidMuted: '#8E949E',
  voidRule: '#2A2F38',
};

const dark: Palette = {
  ground: '#121820',
  surface: '#1B222C',
  surfaceAlt: '#242C38',
  ink: '#F4F3F0',
  inkStrong: '#D3D7DB',
  inkMuted: '#9AA2AA',
  inkFaint: '#7C848D',
  accent: '#1878D8',
  accentDeep: '#0F5BB5',
  accentText: '#7FB4EE',
  accentSoft: 'rgba(127,180,238,0.18)',
  accentInk: '#FFFFFF',
  scan: '#3FC6EE',
  risk: '#F0897F',
  riskSoft: '#2E1C1B',
  riskInk: '#F4C3BD',
  riskRule: '#5A302C',
  warn: '#E8B45C',
  warnSoft: '#2E2617',
  warnInk: '#F0DCB4',
  good: '#6FD3AC',
  goodSoft: '#182C23',
  goodInk: '#BCE7D2',
  info: '#C4DDF7',
  infoSoft: '#16283A',
  rule: '#2C3542',
  ruleStrong: '#3A4452',
  overlay: 'rgba(6,8,9,0.72)',
  chrome: '#14181D',
  void: '#060809',
  voidInk: '#EDEBE7',
  voidMuted: '#8E949E',
  voidRule: '#1E232A',
};

export const palettes: Record<Scheme, Palette> = { light, dark };

/**
 * Semantic colours for content sitting ON the void panel.
 *
 * The panel is dark in both schemes, so the dark scheme's readable hues are
 * the right ones whichever scheme is in force. A risk figure on the panel is
 * `onVoid.risk`, never `p.risk` — in light mode `p.risk` is #C4322A, which
 * nearly disappears into #101319.
 */
export const onVoid = {
  accent: '#7FB4EE',
  risk: '#F0897F',
  warn: '#E8B45C',
  good: '#6FD3AC',
  scan: '#3FC6EE',
  /** A track or an unfilled meter segment. */
  track: 'rgba(244,242,238,0.14)',
} as const;

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
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Radii, tightened in the instrument pass.
 *
 * The prototype ran 12/14/18/20 and that is a large part of why it read as a
 * pinboard of pastel cards — the same finding web made at 14px (§7). Web
 * settled on 4/6/10/16; a phone screen has its own rounded corners and a
 * thumb-sized control wants a little more, so mobile sits one step rounder
 * and no further.
 */
export const radius = {
  /** Status badges — the mono "CHECK", "DEMO" tags. */
  xs: 4,
  /** Chips, segment pills, the smallest tiles. */
  sm: 6,
  /** Inputs, buttons, icon tiles — the workhorse. */
  md: 10,
  /** Notices and popovers. */
  lg: 12,
  /** Cards and panels. Same as `lg` on purpose: one card radius, not two. */
  xl: 12,
  /** The void panel. */
  xxl: 16,
  /** The top corners of a bottom sheet. */
  sheet: 20,
  pill: 999,
} as const;

/**
 * Control heights. `tap` is the floor for anything pressable — it is the
 * accessibility minimum, not a style choice.
 */
export const control = {
  tap: 44,
  input: 52,
  button: 52,
  /** The amount field, which is taller than a plain input. */
  amount: 56,
  tabItem: 58,
} as const;

/**
 * Two families, one system — the same two web uses (DESIGN-HANDOFF.md §6).
 *
 * Archivo, a highway-signage grotesque that holds at 300 set very large, for
 * everything read as language. IBM Plex Mono for everything read as a value:
 * an amount in a column, an ATO label, a date in a ledger gutter, the small
 * uppercase labels. That split is domain truth rather than decoration — a
 * receipt really is printed in mono.
 *
 * These are LOGICAL names. `src/theme/text.tsx` resolves (family, weight) to
 * the face that was actually loaded, because on React Native a custom face is
 * one file per weight and `fontWeight` alone does not pick between them — on
 * Android it fakes a bold, on iOS it can fall back to the system font. Every
 * `Text` in the app goes through that resolver, so a screen can keep writing
 * `fontWeight: '600'` and get Archivo SemiBold.
 *
 * The old rule here was "system fonts on purpose: a custom face can fail to
 * load five minutes before a demo". The faces are now bundled with the app and
 * loaded before the first frame; if loading ever does fail, the resolver hands
 * back the system face and the app renders exactly as it did before this pass.
 */
export const font = {
  sans: 'Archivo',
  mono: 'PlexMono',
  /** Kept for screens written before the pass. Same as `sans`. */
  body: 'Archivo',
} as const;

/**
 * The type scale.
 *
 * The identity is the contrast between two registers: an airy 300 headline or
 * figure against a tight, wide-tracked mono label. Weight is spent sparingly —
 * nothing in this scale is heavier than 500, and a `fontWeight: '700'` written
 * on a screen resolves to SemiBold (600), which is as heavy as this app gets.
 */
export const type = {
  /** Splash and sign-in only. */
  splash: { fontFamily: font.sans, fontSize: 40, lineHeight: 44, fontWeight: '300', letterSpacing: -1.2 },
  /** The number a screen exists to show — what is left, a balance, a total. */
  hero: { fontFamily: font.sans, fontSize: 52, lineHeight: 56, fontWeight: '300', letterSpacing: -1.8 },
  /** A tab root's title, set large and light. */
  display: { fontFamily: font.sans, fontSize: 34, lineHeight: 40, fontWeight: '300', letterSpacing: -1 },
  h1: { fontFamily: font.sans, fontSize: 26, lineHeight: 32, fontWeight: '400', letterSpacing: -0.6 },
  h2: { fontFamily: font.sans, fontSize: 20, lineHeight: 26, fontWeight: '500', letterSpacing: -0.3 },
  h3: { fontFamily: font.sans, fontSize: 17, lineHeight: 22, fontWeight: '500', letterSpacing: -0.2 },
  /** Figures inside a card — an amount field, a per-row total. */
  figure: { fontFamily: font.mono, fontSize: 20, lineHeight: 26, fontWeight: '400', letterSpacing: -0.4 },
  /** Text typed into an input. 16px or iOS zooms the field on focus. */
  input: { fontFamily: font.sans, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  body: { fontFamily: font.sans, fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  small: { fontFamily: font.sans, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallStrong: { fontFamily: font.sans, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  tiny: { fontFamily: font.sans, fontSize: 11, lineHeight: 15, fontWeight: '400' },
  /** An amount in a list or a column. Mono, so a column of them aligns. */
  amount: { fontFamily: font.mono, fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.2 },
  /** A small figure — a date in a ledger gutter, a count, a share. */
  mono: { fontFamily: font.mono, fontSize: 12, lineHeight: 16, fontWeight: '400' },
  /** Tab bar captions. */
  tab: {
    fontFamily: font.mono,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  /**
   * The mono label — web's 11px / 0.18em / uppercase, at mobile's 0.13em so
   * a longer label still fits one line at 390pt. It names a value or a group;
   * it is NOT an eyebrow to put over every section (§12.1).
   */
  label: {
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>;

/** Figures that line up in columns. Money should always use this.
 *  Not `as const`: RN's TextStyle wants a mutable FontVariant[]. */
export const numeric: { fontVariant: TextStyle['fontVariant'] } = {
  fontVariant: ['tabular-nums'],
};

/**
 * Motion. Every animation in the app reports something the system did — a
 * figure arriving, a meter filling to a measured value, a row settling after a
 * refresh. Nothing drifts. Durations are short because this is a tool used at
 * a counter, not a showcase.
 *
 * Reanimated's entering animations and `withTiming` both honour the OS
 * reduce-motion setting when given `ReduceMotion.System` (the default for
 * layout animations), so a reduced-motion user gets the finished state.
 */
export const motion = {
  fast: 140,
  base: 220,
  slow: 420,
  /** A meter filling, a figure settling. */
  settle: 640,
  /** Per-item delay in a list or a glyph run. */
  stagger: 26,
  /** Decelerating, no overshoot — things arrive and stop. */
  ease: Easing.bezier(0.2, 0.8, 0.2, 1),
} as const;

/**
 * Elevation, for things that genuinely float: a sheet, the menu panel, a
 * toast. A card on the page has none — separation on the page is a hairline,
 * not a shadow.
 */
export const elevation = {
  float: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
} as const;
