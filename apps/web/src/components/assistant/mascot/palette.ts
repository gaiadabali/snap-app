/**
 * Snapper's colours (sRGB hex). Recoloured 2026-11-27 for the orange rebrand:
 * the body is Shutter Orange (#EA542D, `--s-brand`) from a bright crown
 * (`--s-grad-bright` starts at #F26A44) down to the deep orange underneath;
 * the face is docket paper; the brackets are the logo's white. It was the old
 * app icon's blue (#1878D8 with a #1E9DE0 crown and a cyan rim); shapes,
 * expressions and the rig are unchanged, only fills, rim light and shadows.
 */
export const BODY = {
  crown: 0xff7a4d,
  upper: 0xea542d, // --s-brand
  lower: 0xc43512, // --s-brand-2
  under: 0xa42f10, // --s-brand-deep
  arm: 0xdc4a22,
  rim: 0xffb89a, // the peach fresnel glow at the silhouette
  emissive: 0x4a1406, // keeps the shadow side warm instead of brown-black
};

export const PAPER = {
  sheet: '#FFFDF8',
  shade: '#F3EFE6',
  rule: 'rgba(178, 48, 15, 0.10)',
  ruleStrong: 'rgba(178, 48, 15, 0.16)',
  print: 'rgba(11, 17, 26, 0.10)',
};

/** --s-ink: the eyes' glossy ink. */
export const INK = 0x0b111a;
export const MOUTH = { line: '#0B111A', inside: '#3A1626', tongue: '#FF8E93' };
export const BLUSH = 'rgba(255, 112, 138, 1)';

export const BRACKET = 0xffffff;
/** The shutter's silver collar (its cap is the brackets' white). */
export const SHUTTER = { ring: 0xc9d3de };

/** The thinking scan line (apricot, the same hue as --s-scan in dark). */
export const SCAN = '#FFB27A';

/** Thinking dots: brand orange, apricot, white, twice round the ring. */
export const DOT_COLOURS = ['#EA542D', '#FFB27A', '#FFFFFF', '#EA542D', '#FFB27A', '#FFFFFF'];

/** Sparkle tints (happy): apricot and white. */
export const SPARK_TINTS = [0xffffff, 0xffc8a8, 0xffffff, 0xffb27a, 0xfff0e6, 0xffc8a8, 0xffffff, 0xffb27a];
