import { Platform, type TextStyle } from 'react-native';

/**
 * Sampled from "Snap Apps Prototype.dc.html" (redesign brief, 2026-09-19).
 *
 * The identity colours are still the measured ones from the launch film:
 * `accent` #1878D8, `scan` #1CA8DB, and the risk/warn/good hues. Those did not
 * move and must not.
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
  /** Brand fill. White sits on this in both schemes, so it does not theme. */
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
};

export const palettes: Record<Scheme, Palette> = { light, dark };

/**
 * The hero card gradient — sign-in, the credits balance, the plan card.
 * Three stops, 135°. Consumed by `<Hero>` in components/ui.tsx.
 */
export const heroGradient = {
  colors: ['#0F5BB5', '#1569BE', '#0A4A96'] as const,
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
 * System fonts on purpose. A custom face is one more thing that can fail to
 * load on a client's device five minutes before a demo, and it buys little here
 * — what this app actually needs from type is aligned digits, which
 * `fontVariant: tabular-nums` gives on both platforms.
 */
export const font = {
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export const type = {
  /** Splash only. */
  splash: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.7 },
  /** The number a screen exists to show — a balance, a total. */
  hero: { fontSize: 40, lineHeight: 46, fontWeight: '700' },
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.4 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
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

/** Figures that line up in columns. Money should always use this.
 *  Not `as const`: RN's TextStyle wants a mutable FontVariant[]. */
export const numeric: { fontVariant: TextStyle['fontVariant'] } = {
  fontVariant: ['tabular-nums'],
};
