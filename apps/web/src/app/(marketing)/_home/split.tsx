import type { CSSProperties } from 'react';

import { IconTile, Reveal, Shell, aud } from '@/design/site';
import { DocketPaper } from '@/design/site/app-ui';
import { DOCKET, type DocketLine } from '@/design/site/demo';
import { Icon } from '@/design/site/icons';

import './split.css';

/**
 * "One docket. Two tax answers."
 *
 * The site's signature demonstration of why reading every line matters. The
 * paper docket sits on its own on the left; on the right the same docket is
 * read two ways, and a native radio pair (no JavaScript — see split.css)
 * switches between them. Default: every line.
 *
 *   Every line: GST-free (milk, bread, eggs) and taxable (pie, drink, coffee)
 *               sort into two groups. GST is DOCKET.gst.
 *   The total:  one lump, GST assumed at one eleventh, and a red warning that
 *               it claims DOCKET.overClaim of GST that was never charged.
 *
 * Both readings are in the server-rendered HTML. The one that is not showing
 * is faded and `visibility: hidden`, so a crawler reads both and a screen
 * reader reads the one on screen. Every figure comes from DOCKET.
 */

/* Row geometry in px. Mirrors split.css (.split-row, .split-head, .split-foot,
   .split-view-lines gap, .split-result): the rows slide toward the middle of
   the block when the reading collapses to a total. */
const ROW = 44;
const HEAD = 48;
const FOOT = 44;
const GAP = 12;
const RESULT = 64;

type Group = {
  key: 'free' | 'taxable';
  title: string;
  sum: string;
  lines: readonly DocketLine[];
};

const GROUPS: readonly Group[] = [
  {
    key: 'free',
    title: 'GST-free',
    sum: DOCKET.gstFree,
    lines: DOCKET.lines.filter((l) => !l.taxable),
  },
  {
    key: 'taxable',
    title: 'Taxable',
    sum: DOCKET.taxable,
    lines: DOCKET.lines.filter((l) => l.taxable),
  },
];

/** Where each row sits in the lines view, and how far it is from the middle. */
const LAYOUT = (() => {
  const heights = GROUPS.map((g) => HEAD + g.lines.length * ROW + FOOT);
  const block = heights.reduce((a, b) => a + b, 0) + GAP * (GROUPS.length - 1);
  const middle = (block + GAP + RESULT) / 2;
  let top = 0;
  let index = 0;
  return GROUPS.map((g, gi) => {
    const groupTop = top;
    top += (heights[gi] ?? 0) + GAP;
    return {
      ...g,
      rows: g.lines.map((line, r) => {
        const centre = groupTop + HEAD + r * ROW + ROW / 2;
        return { line, i: index++, dy: Math.round(middle - centre) };
      }),
    };
  });
})();

export function HomeSplit() {
  return (
    <section className="band-mist section">
      <Shell>
        <div className="split-stage grid items-start lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-x-16 xl:gap-x-24">
          {/* ── Heading ───────────────────────────────────────────────── */}
          <Reveal className="lg:col-start-2 lg:row-start-1">
            <h2 className="hd-2">One docket. Two tax answers.</h2>
            <p className="lede mt-6 max-w-[40ch]">
              Both readers see the same paper. Only one of them can tell a carton of milk from a hot
              pie.
            </p>
          </Reveal>

          {/* ── The switch ────────────────────────────────────────────── */}
          <Reveal className="mt-10 lg:col-start-2 lg:row-start-2">
            <fieldset className="split-seg">
              <legend className="sr-only">How to read this docket</legend>
              <input
                className="split-in split-in-total sr-only"
                type="radio"
                name="split-reading"
                id="split-reading-total"
                value="total"
                aria-controls="split-reading"
              />
              <label className="split-opt" htmlFor="split-reading-total">
                Read the total
              </label>
              <input
                className="split-in split-in-lines sr-only"
                type="radio"
                name="split-reading"
                id="split-reading-lines"
                value="lines"
                aria-controls="split-reading"
                defaultChecked
              />
              <label className="split-opt" htmlFor="split-reading-lines">
                Read every line
              </label>
            </fieldset>
          </Reveal>

          {/* ── The docket, on its own ────────────────────────────────── */}
          <Reveal
            variant="left"
            className="split-paper mt-14 lg:col-start-1 lg:row-span-4 lg:row-start-1 lg:mt-0 lg:self-center"
          >
            <div className="mx-auto w-[300px] max-w-full">
              <div className="split-sheet" aria-hidden>
                <DocketPaper locks />
              </div>
              <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.8125rem] text-[var(--s-ink-3)]">
                <li>
                  <span
                    className="split-legend-dot"
                    style={{ borderColor: 'var(--s-green-2)', background: 'var(--s-green-soft)' }}
                    aria-hidden
                  />
                  GST-free
                </li>
                <li>
                  <span
                    className="split-legend-dot"
                    style={{ borderColor: 'var(--s-blue)', background: 'var(--s-blue-soft)' }}
                    aria-hidden
                  />
                  Taxable, marked *
                </li>
              </ul>
            </div>
          </Reveal>

          {/* ── The reading ───────────────────────────────────────────── */}
          <Reveal variant="fade" id="split-reading" className="split-reading mt-12 lg:col-start-2 lg:row-start-3 lg:mt-8">
            {/* Every line */}
            <div className="split-view split-view-lines">
              {LAYOUT.map((g) => (
                <div key={g.key} className="split-group" data-tone={g.key}>
                  <div className="split-head">
                    <span className="flex items-center gap-3">
                      <IconTile
                        name={g.key === 'free' ? 'cart' : 'coffee'}
                        tone={g.key === 'free' ? 'green' : 'blue'}
                        size={30}
                      />
                      <h3 className="text-[1rem] font-[650] tracking-[-0.02em]">{g.title}</h3>
                    </span>
                    <span className="figure text-[1.125rem] font-[650]">{aud(g.sum)}</span>
                  </div>
                  <ul>
                    {g.rows.map(({ line, i, dy }) => (
                      <li
                        key={line.label}
                        className="split-row"
                        style={{ ['--i' as string]: i, ['--dy' as string]: dy } as CSSProperties}
                      >
                        <span className="min-w-0 truncate">{line.label}</span>
                        <span className="figure shrink-0 font-[560]">{aud(line.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="split-foot">
                    {g.key === 'free' ? (
                      <span className="flex items-center gap-2">
                        <Icon name="check" size={15} strokeWidth={2.4} className="text-[var(--s-green)]" />
                        No GST charged on these lines
                      </span>
                    ) : (
                      <>
                        <span>GST included, one eleventh of {aud(DOCKET.taxable)}</span>
                        <span className="figure font-[650] text-[var(--s-ink)]">{aud(DOCKET.gst)}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <div className="split-result">
                <span>
                  <span className="block text-[0.9375rem] font-[650] tracking-[-0.015em]">
                    GST on this docket: {aud(DOCKET.gst)}
                  </span>
                  <span className="block text-[0.8125rem] text-[var(--s-ink-2)]">
                    Read as a total, it would have assumed {aud(DOCKET.totalOnlyGst)}.
                  </span>
                </span>
                <Icon name="check-circle" size={24} />
              </div>
            </div>

            {/* The total */}
            <div className="split-view split-view-total">
              <div className="split-lump">
                <div className="text-[0.875rem] font-[560] text-[var(--s-ink-3)]">Total on the docket</div>
                <div className="figure mt-1 text-[clamp(2.75rem,5vw,3.75rem)] leading-none font-[650]">
                  {aud(DOCKET.total)}
                </div>
                <p className="small mt-3 max-w-[42ch]">
                  One number. It cannot tell milk from a hot pie, so all of it is treated as taxable.
                </p>

                <div className="my-6 flex items-baseline justify-between gap-4 border-y border-[var(--s-edge)] py-4">
                  <span className="text-[0.9375rem] text-[var(--s-ink-2)]">GST assumed at one eleventh</span>
                  <span className="figure text-[1.375rem] font-[650]">{aud(DOCKET.totalOnlyGst)}</span>
                </div>

                <div className="split-warn" role="note">
                  <Icon name="alert" size={22} strokeWidth={2} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[1rem] font-[650] tracking-[-0.015em]">
                      Over-claim: {aud(DOCKET.overClaim)}
                    </div>
                    <p className="mt-1 text-[0.875rem] leading-snug text-[var(--s-ink-2)]">
                      This claims {aud(DOCKET.overClaim)} of GST that was never charged: {aud(DOCKET.totalOnlyGst)}{' '}
                      claimed, {aud(DOCKET.gst)} on the docket.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* ── The line to take away ─────────────────────────────────── */}
          <Reveal className="mt-8 border-t border-[var(--s-edge-2)] pt-6 lg:col-start-2 lg:row-start-4">
            <p className="text-[1.25rem] leading-snug font-[620] tracking-[-0.025em] sm:text-[1.5rem]">
              Same docket.{' '}
              <span className="text-[var(--s-ink-3)]">Only one of these is a GST claim you can defend.</span>
            </p>
          </Reveal>
        </div>
      </Shell>
    </section>
  );
}
