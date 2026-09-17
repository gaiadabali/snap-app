/**
 * One guard, for one failure that has already happened.
 *
 * `.seam` was the horizontal hairline that opens a section. A second, unrelated
 * component took the same class for a vertical join between screens, its rule
 * landed later in the file, and CSS did what CSS does: the later rule won.
 * Three existing elements were silently restyled into 72px vertical sticks.
 *
 * Nothing in the toolchain could see it. The stylesheet is valid, typecheck
 * passes, every unit test passes, every page still returns 200 and still has
 * all its text. The only symptom was a screenshot looking wrong — which is a
 * bad place for a constraint to live, and is the third time this week a real
 * rule had no checker behind it (a Dockerfile COPY with green CI and a dead
 * container; a `./x.js` specifier with a green typecheck and a dead bundler).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not ban a class appearing twice.
 * This stylesheet is built on exactly that: a component states its finished
 * state at the top level and then re-states parts of itself inside
 * `@supports (animation-timeline: view())`, `@media (prefers-reduced-motion)`
 * and `.pin-track`. Those are overrides and they are the architecture.
 *
 * What it bans is narrower and is the actual bug: the same bare class owning
 * more than one BASE rule at the top level of the file. That is two components
 * claiming one name, and it has no legitimate form — if a base rule genuinely
 * needs splitting, the second half belongs in the first.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/**
 * Selectors of every rule at brace depth 0 — i.e. not nested inside `@media`,
 * `@supports`, `@theme` or a keyframe block.
 *
 * Written as a scanner rather than a regex because the file nests three deep
 * in places and a regex cannot tell a top-level rule from one inside two
 * at-rules, which is the whole distinction being made here.
 */
function topLevelSelectors(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let i = 0;

  while (i < css.length) {
    // Skip comments wholesale so a brace or semicolon inside one cannot
    // desynchronise the scanner.
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) out.push(buf.trim());
      depth++;
      buf = '';
    } else if (ch === '}') {
      depth--;
      buf = '';
    } else if (depth === 0) {
      buf += ch;
    }
    i++;
  }
  return out;
}

/** `.foo` → "foo". Anything more complex is an override, not a base rule. */
function bareClass(selector: string): string | null {
  const s = selector.trim();
  return /^\.[A-Za-z0-9_-]+$/.test(s) ? s.slice(1) : null;
}

describe('globals.css', () => {
  it('gives every class exactly one top-level base rule', () => {
    const counts = new Map<string, number>();

    for (const rule of topLevelSelectors(CSS)) {
      if (rule.startsWith('@') || rule === '') continue;
      for (const part of rule.split(',')) {
        const cls = bareClass(part);
        if (cls) counts.set(cls, (counts.get(cls) ?? 0) + 1);
      }
    }

    const collisions = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([cls, n]) => `.${cls} (${n} base rules)`);

    expect(
      collisions,
      'Two components have claimed one class name. The later rule silently wins ' +
        'and restyles the earlier component wherever it is used — no error, no ' +
        'failing page, visible only in a screenshot. Rename the newcomer.',
    ).toEqual([]);
  });

  it('finds the rules it is supposed to be reading', () => {
    // A scanner that silently matched nothing would pass the test above
    // forever. These are load-bearing classes; if the parse breaks, this fails.
    const all = topLevelSelectors(CSS);
    const classes = new Set(all.flatMap((r) => r.split(',').map(bareClass)).filter(Boolean));
    expect(classes.has('seam')).toBe(true);
    expect(classes.has('join')).toBe(true);
    expect(classes.has('fieldbox')).toBe(true);
    expect(all.length).toBeGreaterThan(40);
  });
});
