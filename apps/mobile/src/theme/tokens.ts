import { Platform, type TextStyle } from 'react-native';

/**
 * Palette sampled from the Snap Apps teaser, not invented.
 *
 * Every frame of the launch film sits on the same blue — #1878D8 dominant,
 * #0060C0 in the deeper areas — with a cyan scan line (#1CA8DB) sweeping the
 * receipt and the app icon tile running #1C97DB to #237ABD. The product should
 * look like its own advertising, so `accent`, `scan` and the risk/warn hues
 * are measured values rather than a designer's guess, and must not change.
 *
 * The NEUTRALS are a different story. Through 2026-09-14 this file ran its own
 * blue-tinted greys (`ground #F2F7FE`, `rule #C9DCF3`, …) while `apps/web`
 * moved to a warm "docket paper" set — see `docs/DESIGN-HANDOFF.md` §4/§5/§12.5.
 * That was a drift, not a decision: two clients sharing one brand ended up on
 * two different backgrounds. The values below are the web tokens, byte for
 * byte, so `ground`/`surface`/`surfaceAlt`/`ink`/`inkMuted`/`inkFaint`/`rule`/
 * `ruleStrong` (and the soft fills built from them) now read as one palette on
 * both clients. Only the neutrals moved — the identity colours did not.
 */

export type Scheme = 'light' | 'dark';

/** Declared explicitly: `as const` on one scheme would make its hex values
 *  literal types and the other scheme unassignable to it. */
export interface Palette {
  ground: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  /** Cyan from the teaser's scan line. Capture/extraction UI only. */
  scan: string;
  risk: string;
  riskSoft: string;
  warn: string;
  warnSoft: string;
  /** Validated, balanced — a positive that is not the brand accent. */
  good: string;
  goodSoft: string;
  rule: string;
  ruleStrong: string;
  overlay: string;
}

const light: Palette = {
  // Docket paper — apps/web §4.
  ground: '#FAF9F7',
  surface: '#F2F0EC',
  surfaceAlt: '#E7E4DE',
  ink: '#14181D',
  inkMuted: '#5A6068',
  inkFaint: '#8D9299',
  // Measured from the launch film — do not change.
  accent: '#1878D8',
  accentSoft: '#E4EEFA',
  accentInk: '#FFFFFF',
  scan: '#1CA8DB',
  risk: '#C4322A',
  riskSoft: '#F8E7E5',
  warn: '#95590A',
  warnSoft: '#F7EEDC',
  good: '#1B6E4F',
  goodSoft: '#E2EFE9',
  rule: '#E2DFD8',
  ruleStrong: '#C9C5BC',
  overlay: 'rgba(20,24,29,0.55)',
};

const dark: Palette = {
  // apps/web §5.
  ground: '#0E1116',
  surface: '#161A21',
  surfaceAlt: '#1F242C',
  ink: '#EDEBE7',
  inkMuted: '#9BA1A9',
  inkFaint: '#6C737C',
  // Same identity colours as light — measured, not themed.
  accent: '#4DA3F5',
  accentSoft: '#13243A',
  accentInk: '#05101E',
  scan: '#3FC6EE',
  risk: '#F08B80',
  riskSoft: '#2C1A18',
  warn: '#E5B871',
  warnSoft: '#2A2114',
  good: '#6FD3AC',
  goodSoft: '#11241D',
  rule: '#262B33',
  ruleStrong: '#3A414B',
  overlay: 'rgba(6,8,9,0.72)',
};

export const palettes: Record<Scheme, Palette> = { light, dark };

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
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
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
  display: { fontSize: 32, lineHeight: 36, fontWeight: '700' },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
} as const;

/** Figures that line up in columns. Money should always use this.
 *  Not `as const`: RN's TextStyle wants a mutable FontVariant[]. */
export const numeric: { fontVariant: TextStyle['fontVariant'] } = {
  fontVariant: ['tabular-nums'],
};
