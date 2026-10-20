import { Reveal, SectionHead } from '@/design/site';
import { Icon } from '@/design/site/icons';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

import './compare-styles.css';

/**
 * "Not another receipt scanner." The capability matrix, rebuilt for the home
 * page from the vetted copy in `_components/comparison.tsx`
 * (docs/MONETISATION.md §2).
 *
 * The rules it keeps, because a table that overreaches is worse than none:
 *
 * 1. Capability, never quality. Each cell is "does the product do this at
 *    all", which anyone can check. Nothing here says whose reading is better.
 * 2. Date-stamped, and the date is on screen. The market moves.
 * 3. Named competitors, cell values exactly as vetted.
 *
 * The two business rows (BAS view, occupation-aware deductions) describe
 * things the shipped personal app does not show, so they render only behind
 * BUSINESS_SURFACES_ENABLED.
 *
 * Snap Apps sits next to the row labels, not at the far right: on a phone
 * the table scrolls sideways under a pinned first column, and the product the
 * reader came for is the first thing they see.
 */

const AS_AT = '12 September 2026';
const AS_AT_ISO = '2026-09-12';

type Cell = 'yes' | 'no' | string;

const COMPETITORS = ['Hubdoc', 'Dext', 'myDeductions', 'Ozly'] as const;

type Row = {
  capability: string;
  note?: string;
  cells: readonly [Cell, Cell, Cell, Cell];
  us: Cell;
  headline?: boolean;
};

const BUSINESS_ROWS: readonly Row[] = BUSINESS_SURFACES_ENABLED
  ? [
      { capability: 'Quarterly BAS view', cells: ['no', 'no', 'no', 'yes'], us: 'yes' },
      {
        capability: 'Occupation-aware deductions',
        note: 'Knows what a line-haul driver can claim that a sparky cannot',
        cells: ['no', 'no', 'Partial', 'no'],
        us: 'yes',
      },
    ]
  : [];

const ROWS: readonly Row[] = [
  {
    capability: 'Line items',
    note: 'Reads what was bought, not just the total',
    cells: ['no', 'Extra credits', 'no', 'no'],
    us: 'yes',
  },
  {
    capability: 'Per-category tax subtotals',
    note: 'Splits one docket into its GST-free and taxable halves',
    cells: ['no', 'no', 'no', 'no'],
    us: 'yes',
    headline: true,
  },
  ...BUSINESS_ROWS,
  {
    capability: 'Leaves a blank instead of guessing',
    note: 'Flags a figure it is not sure of for you to fill in',
    cells: ['no', 'no', 'no', 'no'],
    us: 'yes',
  },
  {
    capability: 'Correction trail on an untouched original',
    cells: ['no', 'no', 'no', 'no'],
    us: 'yes',
  },
  {
    capability: 'Price',
    cells: ['Free with Xero', 'From $33.58/mo', 'Free', 'Free tier'],
    us: 'From $0',
  },
];

export function HomeCompare() {
  return (
    <section className="section">
      <div className="shell">
        <SectionHead
          align="split"
          title="Not another receipt scanner."
          lede="Plenty of apps photograph a receipt and file the total. This is what each one does with the lines."
        >
          <p className="mt-6 flex max-w-[46ch] items-start gap-2.5 text-[0.875rem] leading-snug text-[var(--s-ink-3)]">
            <Icon name="calendar" size={17} className="mt-px shrink-0 text-[var(--s-blue-text)]" />
            <span>
              <span className="font-[600] text-[var(--s-ink-2)]">
                As at <time dateTime={AS_AT_ISO}>{AS_AT}</time>
              </span>{' '}
              · capability, not quality — every cell is checkable
            </span>
          </p>
        </SectionHead>

        <Reveal className="mt-12 lg:mt-16">
          <div
            className="compare-scroll"
            role="region"
            aria-label="Capability comparison. Scrolls sideways on small screens."
            tabIndex={0}
          >
            <table className="compare-table">
              <caption className="sr-only">
                Capability comparison between Snap Apps and other Australian receipt tools, as at{' '}
                {AS_AT}. Capability, not quality.
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="compare-sticky w-[10.5rem] py-5 pr-4 text-[0.8125rem] font-[600] text-[var(--s-ink-3)] sm:w-[17rem]"
                  >
                    What it does
                  </th>
                  <th
                    scope="col"
                    className="compare-us w-[8.5rem] px-3 pb-5 pt-4 text-center text-[1.0625rem] font-[650] tracking-[-0.02em]"
                  >
                    Snap Apps
                  </th>
                  {COMPETITORS.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="w-[8.5rem] px-3 py-5 text-center text-[0.9375rem] font-[600] tracking-[-0.01em] text-[var(--s-ink-2)]"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, r) => (
                  <tr key={row.capability} className={row.headline ? 'compare-headline' : undefined}>
                    <th scope="row" className="compare-sticky py-5 pr-4 align-middle font-normal">
                      <span
                        className={
                          row.headline
                            ? 'block text-[1rem] font-[650] leading-snug tracking-[-0.02em] text-[var(--s-ink)] sm:text-[1.0625rem]'
                            : 'block text-[0.9375rem] font-[550] leading-snug tracking-[-0.01em] text-[var(--s-ink)]'
                        }
                      >
                        {row.capability}
                      </span>
                      {row.note ? (
                        <span className="mt-1 block max-w-[34ch] text-[0.8125rem] leading-snug text-[var(--s-ink-3)]">
                          {row.note}
                        </span>
                      ) : null}
                      {row.headline ? (
                        <span className="mt-2 inline-flex h-6 items-center rounded-full bg-[var(--s-blue-soft)] px-2.5 text-[0.6875rem] font-[650] uppercase tracking-[0.06em] text-[var(--s-blue-text)]">
                          Only column with a tick
                        </span>
                      ) : null}
                    </th>
                    <td className="compare-us px-3 py-5 text-center align-middle">
                      <Mark value={row.us} big={row.headline} i={r} us />
                    </td>
                    {row.cells.map((cell, i) => (
                      <td key={COMPETITORS[i] ?? i} className="px-3 py-5 text-center align-middle">
                        <Mark value={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <p className="mt-3 text-[0.8125rem] text-[var(--s-ink-3)] lg:hidden">
          Scroll sideways to see every product.
        </p>
        <p className="mt-6 max-w-[64ch] text-[0.8125rem] leading-relaxed text-[var(--s-ink-3)] lg:mt-8">
          Compared on what each product does, from publicly documented features, not on how well it
          does it. Product names are the trade marks of their owners.
        </p>
      </div>
    </section>
  );
}

function Mark({
  value,
  big = false,
  us = false,
  i = 0,
}: {
  value: Cell;
  big?: boolean;
  us?: boolean;
  i?: number;
}) {
  const pop = us ? 'compare-pop' : '';
  const style = us ? { ['--i' as string]: i } : undefined;
  if (value === 'yes') {
    return (
      <span className={`compare-mark compare-mark-yes ${big ? 'compare-mark-big' : ''} ${pop}`} style={style}>
        <Icon name="check" size={big ? 19 : 16} strokeWidth={2.6} />
        <span className="sr-only">Yes</span>
      </span>
    );
  }
  if (value === 'no') {
    return (
      <span className="compare-mark compare-mark-no">
        <Icon name="x" size={15} strokeWidth={2} />
        <span className="sr-only">No</span>
      </span>
    );
  }
  return (
    <span
      className={
        us
          ? `${pop} inline-block text-[0.9375rem] font-[650] tracking-[-0.01em] text-[var(--s-ink)]`
          : 'inline-block text-[0.8125rem] leading-snug text-[var(--s-ink-2)]'
      }
      style={style}
    >
      {value}
    </span>
  );
}
