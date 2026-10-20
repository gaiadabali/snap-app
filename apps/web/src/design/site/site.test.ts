import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * A kit class must never share a name with a Tailwind utility.
 *
 * site.css sits in `@layer components`, BELOW utilities, so when a name
 * collides Tailwind's rule silently wins for whatever it sets. That happened:
 * the heading classes were once `h-1`…`h-4`, which are Tailwind's HEIGHT
 * utilities, so every `h-2` heading got `height: 0.5rem` and its second line
 * spilled over the section below. Nothing errored; it was visible only on the
 * rendered page.
 *
 * The oracle is Tailwind itself: every class site.css defines is handed to the
 * real compiler, and any it turns into a utility is a collision.
 */
const CSS = readFileSync(join(__dirname, 'site.css'), 'utf8');

/** Every stylesheet the marketing and auth surfaces add on top of the kit. */
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith('.css') ? [full] : [];
  });
}
const APP = join(__dirname, '..', '..', 'app');
const SECTION_CSS = [...cssFiles(join(APP, '(marketing)')), ...cssFiles(join(APP, '(auth)'))];

/** Class names that appear in a rule's selector. */
function definedClasses(css: string): string[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set<string>();
  for (const m of noComments.matchAll(/([^{};]+)\{/g)) {
    const selector = (m[1] ?? '').trim();
    if (selector.startsWith('@') || /^(from|to|\d+%)/.test(selector)) continue;
    for (const c of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) if (c[1]) out.add(c[1]);
  }
  return [...out];
}

let build: (candidates: string[]) => string;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('tailwindcss/index.css');
  const compiler = await compile('@import "tailwindcss";', {
    base: dirname(entry),
    loadStylesheet: async (_id: string, base: string) => ({
      path: entry,
      base,
      content: readFileSync(entry, 'utf8'),
    }),
  });
  build = (candidates) => compiler.build(candidates);
});

/** The classes from `names` that Tailwind generates a utility for. */
function utilitiesAmong(names: string[]): string[] {
  return names.filter((n) => new RegExp(`\\.${n.replace(/[-]/g, '\\-')}\\s*\\{`).test(build([n])));
}

describe('site.css', () => {
  const classes = definedClasses(CSS);

  it('finds the classes it is supposed to be reading', () => {
    expect(classes).toContain('phone');
    expect(classes).toContain('hd-2');
    expect(classes.length).toBeGreaterThan(40);
  });

  it('defines no class that is also a Tailwind utility', () => {
    const clashes = utilitiesAmong(classes);
    expect(clashes, `kit classes shadowed by Tailwind utilities: ${clashes.join(', ')}`).toEqual([]);
  });

  it('lets no section stylesheet take a utility name either', () => {
    expect(SECTION_CSS.length).toBeGreaterThan(5);
    for (const file of SECTION_CSS) {
      const clashes = utilitiesAmong(definedClasses(readFileSync(file, 'utf8')));
      expect(clashes, `${file}: ${clashes.join(', ')}`).toEqual([]);
    }
  });

  it('catches the collisions it was written for', () => {
    expect(utilitiesAmong(['h-2', 'ring', 'hd-2', 'ring-draw'])).toEqual(['h-2', 'ring']);
  });
});
