import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Regression guards for the 2026-11-27 axe run on snapapps.gaiada.com.
 *
 * 1. `.story-num` (color-contrast): the step numerals were a 13% ink wash,
 *    ~1.2:1. They are now solid tokens, and the active step uses the orange
 *    TEXT colour (--s-brand-text), never the fill orange. The pairs are
 *    computed from the real tokens in site.css and the real rule in story.css.
 * 2. The iPhone "in development" tile is not interactive, so it must not be a
 *    role=button (label-content-name-mismatch).
 */
const SITE = readFileSync(join(__dirname, 'site.css'), 'utf8');
const STORY = readFileSync(join(__dirname, '..', '..', 'app', '(marketing)', '_home', 'story.css'), 'utf8');
const INDEX = readFileSync(join(__dirname, 'index.tsx'), 'utf8');

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

/** A token's value inside the block that opens with `selector` (first match). */
function token(block: string, name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1]!;
}
const LIGHT_AT = SITE.indexOf('\n:root {');
const DARK_AT = SITE.indexOf('\n:root[data-theme="dark"] {');
const LIGHT = SITE.slice(LIGHT_AT, SITE.indexOf('\n}\n', LIGHT_AT));
const DARK = SITE.slice(DARK_AT, SITE.indexOf('\n}\n', DARK_AT));

const THEMES = {
  light: { block: LIGHT, brandText: '#b2300f', fallbackBrandText: null },
  dark: { block: DARK, brandText: '#ff8a66', fallbackBrandText: null },
} as const;

describe.each(Object.entries(THEMES))('.story-num contrast (%s)', (_name, t) => {
  const grounds = [token(t.block, '--s-bg'), token(t.block, '--s-mist')];
  // Axe treats 3rem+ bold-ish numerals as large text (3:1); we hold them to 4.5:1 anyway.
  it.each(grounds)('inactive numeral (--s-ink-3) on %s is AA', (g) => {
    expect(ratio(token(t.block, '--s-ink-3'), g)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(grounds)('active numeral (--s-brand-text) on %s is AA', (g) => {
    expect(token(t.block, '--s-brand-text')).toBe(t.brandText);
    expect(ratio(token(t.block, '--s-brand-text'), g)).toBeGreaterThanOrEqual(4.5);
  });
  it('the fill orange is not usable as numeral text on the page ground', () => {
    expect(ratio(token(LIGHT, '--s-brand'), token(LIGHT, '--s-bg'))).toBeLessThan(4.5);
  });
});

describe('story.css .story-num uses those tokens', () => {
  const rules = STORY.replace(/\/\*[\s\S]*?\*\//g, '');
  const numRules = [...rules.matchAll(/\.story-num\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  it('sets only solid token colours (no ink wash, no fill orange)', () => {
    const colours = numRules.join('\n').match(/color:[^;]+;/g) ?? [];
    expect(colours.length).toBeGreaterThan(0);
    for (const c of colours) {
      expect(c).not.toMatch(/transparent/);
      expect(c).not.toMatch(/var\(--s-brand\)/);
      expect(c).toMatch(/--s-ink-3/);
    }
    expect(numRules.join('\n')).toMatch(/--s-brand-text/);
  });
});

describe('iPhone "in development" tile', () => {
  const block = INDEX.slice(INDEX.indexOf('export function StoreButtons'), INDEX.indexOf('function AndroidGlyph'));
  it('is not a role=button and carries no aria-label overriding its visible text', () => {
    expect(block).not.toMatch(/role="button"/);
    expect(block).not.toMatch(/aria-label/);
    expect(block).not.toMatch(/tabIndex/);
    expect(block).toContain('iPhone · in development');
  });
});
