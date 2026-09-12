import { Platform, type TextStyle } from 'react-native';

/**
 * Palette sampled from the Snap Apps teaser, not invented.
 *
 * Every frame of the launch film sits on the same blue — #1878D8 dominant,
 * #0060C0 in the deeper areas — with a cyan scan line (#1CA8DB) sweeping the
 * receipt and the app icon tile running #1C97DB to #237ABD. The product should
 * look like its own advertising, so these are the measured values rather than a
 * designer's guess.
 *
 * Red stays reserved for money at risk. It is warmed slightly from the usual
 * ledger red so it reads as a warning against blue rather than fighting it.
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
  /** Cyan from the teaser's scan line. Capture UI only. */
  scan: string;
  risk: string;
  riskSoft: string;
  warn: string;
  warnSoft: string;
  rule: string;
  ruleStrong: string;
  overlay: string;
}

const light: Palette = {
  ground: '#F2F7FE',
  surface: '#E5EFFC',
  surfaceAlt: '#D3E4F9',
  ink: '#0A1A2F',
  inkMuted: '#4C6280',
  inkFaint: '#8299B4',
  accent: '#1878D8',
  accentSoft: '#DCEAFB',
  accentInk: '#FFFFFF',
  scan: '#1CA8DB',
  risk: '#C4322A',
  riskSoft: '#FBE3E1',
  warn: '#95590A',
  warnSoft: '#FBEFD8',
  rule: '#C9DCF3',
  ruleStrong: '#A5C2E4',
  overlay: 'rgba(7,22,42,0.55)',
};

const dark: Palette = {
  ground: '#071527',
  surface: '#0E2440',
  surfaceAlt: '#173355',
  ink: '#E6F0FC',
  inkMuted: '#9DB6D2',
  inkFaint: '#6E8BAC',
  accent: '#4DA3F5',
  accentSoft: '#122A4B',
  accentInk: '#04101E',
  scan: '#3FC6EE',
  risk: '#F08B80',
  riskSoft: '#331B1A',
  warn: '#E5B871',
  warnSoft: '#2B2214',
  rule: '#1C3A5E',
  ruleStrong: '#2F5480',
  overlay: 'rgba(2,10,22,0.72)',
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
