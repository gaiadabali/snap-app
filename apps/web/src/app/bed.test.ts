/**
 * Five rules the bed depends on, none of which anything could see.
 *
 * The bed (`(marketing)/_components/scan-bed.tsx` + the "The bed" layer in
 * `globals.css`) is a background. That is the whole problem: when one of these
 * breaks, the stylesheet is still valid, the typecheck is still green, every
 * page still returns 200 with all its text, and the only symptom is a
 * screenshot looking wrong — which is exactly where `globals.test.ts` says a
 * constraint must not be allowed to live. This file is that test's sibling,
 * for the failures this layer can have.
 *
 * Each one below has already happened, or is one careless edit from happening:
 *
 *  1. **`.bed` at `z-index: 0`.** `.sect-3d` transforms every section, and a
 *     transformed element paints with the positioned group — so a bed at 0
 *     joins that group and covers everything still in normal flow. On the home
 *     page that is the final CTA; below 1024px it is the entire document,
 *     behind a sheet of ruled lines.
 *
 *  2. **A named `animation-timeline`.** `.sect-3d` shipped `--screen`
 *     unconditionally and blanked three pages, because an unresolved named
 *     timeline does not fall back — it freezes on the 0% keyframe. The bed's
 *     layers are deliberately on `scroll(root block)`, which resolves on every
 *     page, including ones that have no pin track at all.
 *
 *  3. **The bed eating clicks.** It covers the viewport. One missing
 *     `pointer-events: none` and the page has no working links, everywhere.
 *
 *  4. **`.page-spine` losing its `display: none`.** Every other rule for the
 *     rail is inside `@media (min-width: 1400px)`, so without a top-level
 *     `display: none` the component renders below 1400px as an unstyled,
 *     black-filled SVG sized from its own viewBox: 390x3900 on a handset,
 *     shoving the `h1` to y=4078. That shipped, on six marketing pages, and
 *     the only reason it survived is that nobody opens a decorative left-margin
 *     flourish on a phone.
 *
 *  5. **`Section` painting `--color-ground` again.** It is the same colour
 *     `body` already paints, so putting it back looks like a no-op and reads
 *     like tidying — and it turns every section into an opaque lid, which is
 *     what kept the bed invisible before this shipped.
 *
 * Each assertion was proved by breaking the rule it guards and watching it
 * fail. A checker nobody has seen fire is a comment with a test runner
 * attached.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const PRIMITIVES = readFileSync(join(__dirname, '..', 'design', 'primitives', 'index.tsx'), 'utf8');

/** The declarations of the first rule whose selector matches exactly. */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[\\s{};])${escaped}\\s*\\{([^{}]*)\\}`, 'm').exec(css);
  return match?.[2] ?? null;
}

/** Everything between the bed's banner comment and the carriage's. */
function bedLayer(css: string): string {
  const from = css.indexOf('/* ── The bed ──');
  const to = css.indexOf('/* ── The carriage ──');
  return from === -1 || to === -1 ? '' : css.slice(from, to);
}

describe('the bed', () => {
  it('finds the layer it is supposed to be reading', () => {
    // A scanner that silently matched nothing would pass everything below
    // forever. This is the guard on the guards.
    const layer = bedLayer(CSS);
    expect(layer.length).toBeGreaterThan(1000);
    expect(ruleBody(CSS, '.bed')).not.toBeNull();
    expect(ruleBody(CSS, '.bed__loupe')).not.toBeNull();
  });

  it('keeps the bed behind everything, transformed or not', () => {
    const body = ruleBody(CSS, '.bed') ?? '';
    expect(
      /z-index:\s*-1\b/.test(body),
      '`.bed` must be `z-index: -1`. At 0 it joins the positioned paint group ' +
        'that `.sect-3d` puts every section into, and covers every element still ' +
        'in normal flow — the final CTA, and the whole page below 1024px.',
    ).toBe(true);
  });

  it('never lets the bed take a pointer event', () => {
    const body = ruleBody(CSS, '.bed') ?? '';
    expect(
      /pointer-events:\s*none/.test(body),
      '`.bed` covers the viewport. Without `pointer-events: none` it swallows ' +
        'every click on the page.',
    ).toBe(true);
  });

  it('drives every bed layer from a timeline that always resolves', () => {
    const timelines = [...bedLayer(CSS).matchAll(/animation-timeline:\s*([^;]+);/g)].map((m) =>
      (m[1] ?? '').trim(),
    );

    expect(timelines.length, 'the bed has stopped being scroll-driven').toBeGreaterThan(3);

    const named = timelines.filter((t) => !t.startsWith('scroll('));
    expect(
      named,
      'A bed layer is on a named or view timeline. An unresolved named timeline ' +
        'does not fall back, it freezes on the 0% keyframe — which is how ' +
        '`.sect-3d` blanked three pages. The bed must stay on `scroll(root block)`, ' +
        'which resolves on every page including the ones with no pin track.',
    ).toEqual([]);
  });

  it('keeps the reading rail out of every viewport it was not designed for', () => {
    const body = ruleBody(CSS, '.page-spine') ?? '';
    expect(
      /display:\s*none/.test(body),
      'The FIRST `.page-spine` rule in the file must be `display: none`. Every ' +
        'other rule for it — position, size, `fill: none` — is inside ' +
        '`@media (min-width: 1400px)`, so without this the rail renders below ' +
        '1400px as an unstyled black-filled SVG sized from its viewBox: 390x3900 ' +
        'on a handset, above the hero.',
    ).toBe(true);
  });

  it('keeps `ground` sections transparent so there is something to see', () => {
    // `index.tsx` has several `tones` tables — Rule's, Card's, Section's. The
    // one this test is about is the one with a `ground` key, and picking it by
    // position rather than by content is how a checker quietly starts reading
    // the wrong component.
    const tones = [...PRIMITIVES.matchAll(/const tones = \{([\s\S]*?)\} as const;/g)]
      .map((m) => m[1] ?? '')
      .find((t) => t.includes('ground:'));
    const ground = tones ? /ground:\s*'([^']*)'/.exec(tones)?.[1] : undefined;

    expect(ground, "Section's tone table has moved").toBeTypeOf('string');
    expect(
      ground?.includes('bg-'),
      "`Section` tone `ground` must not paint a background. It would be filling " +
        'the colour `body` already paints, and the only thing that fill ' +
        'accomplishes is making every section an opaque lid over the bed.',
    ).toBe(false);
  });
});
