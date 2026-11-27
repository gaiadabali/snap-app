import { describe, expect, it } from 'vitest';

import { heroGradient, palettes } from '@/theme/tokens';

/**
 * The orange rebrand (2026-11-27) rests on three contrast facts from the GOD
 * Ecosystem Brand Guidelines p20: Ink on Shutter Orange is AA for all text,
 * white on it is large-text only, and orange on Paper is logo-and-large only.
 * These tests keep the palette honest: a label on an orange fill is Ink,
 * orange TEXT is the darker `accentText`, and the semantic colours stay
 * distinguishable from the brand hue.
 */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
/** Blend an `rgba(r,g,b,a)` over an opaque hex. */
function over(rgba: string, ground: string): string {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(rgba)!;
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const [gr, gg, gb] = rgb(ground);
  const mix = (c: number, base: number) => Math.round(c * a + base * (1 - a));
  return '#' + [mix(r, gr), mix(g, gg), mix(b, gb)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

describe.each(['light', 'dark'] as const)('brand palette (%s)', (scheme) => {
  const p = palettes[scheme];

  it('is the official Shutter Orange', () => {
    expect(p.accent).toBe('#EA542D');
  });

  it('puts Ink, not white, on the orange fill (AA for all text)', () => {
    expect(ratio(p.accentInk, p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#FFFFFF', p.accent)).toBeLessThan(4.5);
  });

  it('keeps orange text AA on every ground it sits on', () => {
    for (const ground of [p.ground, p.surface, p.card, over(p.accentSoft, p.ground)]) {
      expect(ratio(p.accentText, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps body text AA on the grounds', () => {
    for (const ground of [p.ground, p.card]) {
      expect(ratio(p.ink, ground)).toBeGreaterThanOrEqual(7);
      expect(ratio(p.inkMuted, ground)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.inkFaint, ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(p.inkMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps risk, warn and good readable and away from the brand hue', () => {
    for (const [fg, bg] of [
      [p.risk, p.ground],
      [p.warn, p.ground],
      [p.good, p.ground],
    ] as const) {
      expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(p.riskInk, p.riskSoft)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(p.warnInk, p.warnSoft)).toBeGreaterThanOrEqual(4.5);
    // Orange is ~12 degrees. Crimson risk sits 25+ away, golden warn 25+ away.
    expect(hueGap(p.risk, p.accent)).toBeGreaterThanOrEqual(25);
    expect(hueGap(p.warn, p.accent)).toBeGreaterThanOrEqual(25);
  });
});

describe('hero gradient', () => {
  it('carries white text at AA on every stop', () => {
    for (const stop of heroGradient.colors) {
      expect(ratio('#FFFFFF', stop)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
