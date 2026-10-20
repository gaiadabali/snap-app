/**
 * Snapper's colours (sRGB hex). The body is the app icon's blue, from the
 * bright crown (`--s-grad-bright` starts at #1E9DE0) down to `--s-blue-deep`
 * underneath; the face is docket paper; the brackets are the icon's white.
 */
export const BLUE = {
  crown: 0x1e9de0,
  upper: 0x1878d8, // --s-blue
  lower: 0x0f5bb5, // --s-blue-2
  under: 0x0a4a96, // --s-blue-deep
  arm: 0x1670d0,
  rim: 0x7fd8ff, // the cyan fresnel glow at the silhouette
  emissive: 0x08306e, // keeps the shadow side blue instead of navy-black
};

export const PAPER = {
  sheet: '#FFFDF8',
  shade: '#F3EFE6',
  rule: 'rgba(15, 91, 181, 0.10)',
  ruleStrong: 'rgba(15, 91, 181, 0.16)',
  print: 'rgba(11, 17, 26, 0.10)',
};

/** --s-ink: the eyes' glossy ink. */
export const INK = 0x0b111a;
export const MOUTH = { line: '#0B111A', inside: '#3A1626', tongue: '#FF8E93' };
export const BLUSH = 'rgba(255, 112, 138, 1)';

export const BRACKET = 0xffffff;
/** The shutter's silver collar (its cap is the brackets' white). */
export const SHUTTER = { ring: 0xc9d3de };

/** The thinking scan line. */
export const SCAN = '#3FC6EE';

/** Thinking dots: brand blue, cyan, white, twice round the ring. */
export const DOT_COLOURS = ['#1878D8', '#1CA8DB', '#FFFFFF', '#1878D8', '#1CA8DB', '#FFFFFF'];

/** Sparkle tints (happy): cyan and white. */
export const SPARK_TINTS = [0xffffff, 0x7fd8ff, 0xffffff, 0x3fc6ee, 0xe8f8ff, 0x7fd8ff, 0xffffff, 0x3fc6ee];
