import { Reveal, cx } from '@/design/primitives';

/**
 * The capability matrix, from `docs/MONETISATION.md` §2.
 *
 * Three rules this table follows, because a comparison table that overreaches
 * is worse than none:
 *
 * 1. **Capability, never quality.** Every cell answers "does the product do
 *    this at all", which is checkable. No claims about whose OCR is better —
 *    that number is not measured against these products yet
 *    (MONETISATION.md §2.1 sets the two conditions before it can be quoted).
 * 2. **Date-stamped.** The market moves; §2 already had to retract a claim
 *    when Ozly shipped a BAS dashboard. A comparison with no date is a
 *    comparison nobody can check.
 * 3. **Fair where a competitor is good.** Dext does extract line items and
 *    the table says so. Ozly does have a quarterly BAS view and the table says
 *    so. Losing a row costs nothing; being caught overclaiming costs the sale.
 *
 * The row that matters is `Per-category tax subtotals` — the one column nobody
 * else can tick at any price, and the reason this table exists.
 */

const AS_AT = '12 September 2026';

type Cell = 'yes' | 'no' | 'Partial' | string;

const COMPETITORS = ['Hubdoc', 'Dext', 'myDeductions', 'Ozly'] as const;

const ROWS: ReadonlyArray<{
  capability: string;
  note?: string;
  cells: readonly [Cell, Cell, Cell, Cell];
  us: Cell;
  headline?: boolean;
}> = [
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
  {
    capability: 'Quarterly BAS view',
    cells: ['no', 'no', 'no', 'yes'],
    us: 'yes',
  },
  {
    capability: 'Occupation-aware deductions',
    note: 'Knows what a line-haul driver can claim that a sparky cannot',
    cells: ['no', 'no', 'Partial', 'no'],
    us: 'yes',
  },
  {
    capability: 'Says "I could not read this"',
    note: 'Abstains instead of guessing a number into your BAS',
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

function Mark({ value, strong = false }: { value: Cell; strong?: boolean }) {
  if (value === 'yes') {
    return (
      <span
        className={cx('text-[15px]', strong ? 'text-[var(--color-good)]' : 'text-[var(--color-ink)]')}
        aria-label="Yes"
      >
        ✓
      </span>
    );
  }
  if (value === 'no') {
    return (
      <span className="text-[15px] text-[var(--color-ink-faint)]" aria-label="No">
        —
      </span>
    );
  }
  return <span className="text-[12px] leading-tight text-[var(--color-ink-muted)]">{value}</span>;
}

export function ComparisonTable() {
  return (
    <Reveal>
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full min-w-[42rem] border-collapse text-left">
          <caption className="sr-only">
            Capability comparison between Snap Apps and other Australian receipt-capture tools, as
            at {AS_AT}.
          </caption>
          <thead>
            <tr className="border-b border-[var(--color-rule-strong)]">
              <th scope="col" className="t-label py-4 pr-4 font-medium text-[var(--color-ink-faint)]">
                Capability
              </th>
              {COMPETITORS.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="t-label px-3 py-4 text-center font-medium text-[var(--color-ink-faint)]"
                >
                  {c}
                </th>
              ))}
              <th
                scope="col"
                className="t-label px-3 py-4 text-center font-medium text-[var(--color-accent)]"
              >
                Snap Apps
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.capability}
                className={cx(
                  'border-b border-[var(--color-rule)]',
                  row.headline && 'bg-[var(--color-accent-soft)]',
                )}
              >
                <th scope="row" className="py-4 pr-4 font-normal align-top">
                  <span
                    className={cx(
                      'block text-[14.5px]',
                      row.headline
                        ? 'font-medium text-[var(--color-ink)]'
                        : 'text-[var(--color-ink)]',
                    )}
                  >
                    {row.capability}
                  </span>
                  {row.note ? (
                    <span className="mt-1 block max-w-[34ch] text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
                      {row.note}
                    </span>
                  ) : null}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={COMPETITORS[i]} className="px-3 py-4 text-center align-middle">
                    <Mark value={cell} />
                  </td>
                ))}
                <td className="px-3 py-4 text-center align-middle">
                  <Mark value={row.us} strong={row.headline} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--color-ink-faint)]">
        Capability comparison as at {AS_AT}, from publicly documented product features. Compared on
        what each product does, not on how accurately it does it — we will publish measured accuracy
        against these tools when it is measured on real Australian paperwork, and not before.
        Product names are the trade marks of their owners.
      </p>
    </Reveal>
  );
}
