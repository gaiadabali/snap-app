import { Money, Reveal } from '@/design/primitives';

/**
 * The same docket, read four ways.
 *
 * The capability matrix below this on the page is the evidence; this is the
 * demonstration. Four products read one servo receipt, and three of them come
 * back with a single tax figure while the fourth comes back with two.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. The obvious version — "they read only
 * the header, we read every line" — would be false, and `comparison.tsx`
 * already says so in its own comments: Dext does extract line items. Getting
 * caught overclaiming on a compliance product costs more than the row is
 * worth. So the demonstration is built on the ONE row nobody else ticks at any
 * price (docs/MONETISATION.md §2): per-category tax subtotals. All four read
 * the docket. All four report `32.20` and `1.40`, because both are printed on
 * it. Only one of them can tell you that the 1.40 belongs to 15.40 of taxable
 * food and that the other 16.80 is GST-free.
 *
 * It is DOM, not WebGL, and that is the right call here rather than a
 * concession. Every figure is real text a screen reader can read and a crawler
 * can index, there is no canvas to fall back from, and it costs nothing in
 * bundle. The scene treatment on this page is reserved for the document
 * itself; this is a table of results, and a table of results should be text.
 */

const DOCKET_TOTAL = '32.20';
const DOCKET_GST = '1.40';

/** Free 4.50 + 3.80 + 8.50 = 16.80. Taxable 6.20 + 3.20 + 6.00 = 15.40. */
const SPLIT_FREE = '16.80';
const SPLIT_TAXABLE = '15.40';

type Reader = {
  name: string;
  /** What this product hands back once it has read the docket. */
  splits: boolean;
  note: string;
};

const READERS: readonly Reader[] = [
  { name: 'Hubdoc', splits: false, note: 'One GST figure for the whole docket' },
  { name: 'Dext', splits: false, note: 'Line items, but one GST figure' },
  { name: 'myDeductions', splits: false, note: 'One GST figure for the whole docket' },
  { name: 'Snap Apps', splits: true, note: 'Each tax category reconciled on its own' },
];

function ReaderCard({ reader, index }: { reader: Reader; index: number }) {
  const mine = reader.splits;
  return (
    <Reveal variant="deal" delay={index}>
      <div
        className={[
          'read-card relative flex h-full flex-col border p-5',
          mine
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
            : 'border-[var(--color-rule)] bg-[var(--color-ground)]',
        ].join(' ')}
        style={{ ['--i' as string]: index }}
      >
        {/*
          The reading sweep. One cyan pass per card, staggered by `--i`, on the
          same scroll timeline as everything else. `scan` is reserved by §3 for
          capture and extraction imagery — reading a docket is exactly that,
          which is why it is allowed here and not on the pricing table.
        */}
        <span className="read-card__sweep" aria-hidden />

        <div className="t-label text-[var(--color-ink-faint)]">{reader.name}</div>

        <div className="mt-5 space-y-1 font-mono text-[12.5px] text-[var(--color-ink-muted)]">
          <div className="flex items-baseline justify-between gap-3">
            <span>Docket total</span>
            <Money amount={DOCKET_TOTAL} />
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span>GST on it</span>
            <Money amount={DOCKET_GST} />
          </div>
        </div>

        <div className="mt-5 border-t border-dashed border-[var(--color-rule-strong)] pt-4">
          <div className="t-label text-[10px] text-[var(--color-ink-faint)]">
            Which half is claimable
          </div>

          {mine ? (
            <div className="read-card__answer mt-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="t-label text-[10px] text-[var(--color-good)]">GST-free</span>
                <Money
                  amount={SPLIT_FREE}
                  className="font-mono text-[15px] text-[var(--color-good)]"
                />
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="t-label text-[10px] text-[var(--color-accent)]">Taxable</span>
                <Money
                  amount={SPLIT_TAXABLE}
                  className="font-mono text-[15px] text-[var(--color-accent)]"
                />
              </div>
            </div>
          ) : (
            /*
              An em dash, not a cross. The three other products are not broken
              and the page does not score points off them — they simply do not
              carry this figure, and saying that plainly is more convincing
              than a red X would be.
            */
            <div className="mt-3 font-mono text-[22px] leading-none text-[var(--color-ink-faint)]">
              —
            </div>
          )}
        </div>

        <p className="mt-auto pt-5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
          {reader.note}
        </p>
      </div>
    </Reveal>
  );
}

export function ReadComparison() {
  return (
    <div>
      <div className="t-label text-[var(--color-ink-faint)]">
        One docket · Coles Express Yass · 11 Sep 2026
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {READERS.map((r, i) => (
          <ReaderCard key={r.name} reader={r} index={i} />
        ))}
      </div>
      <p className="mt-6 max-w-[64ch] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
        All four read the docket, and all four report the same total and the same GST — both are
        printed on it. Only one of them can tell you that the {DOCKET_GST} belongs to{' '}
        {SPLIT_TAXABLE} of hot food and that the other {SPLIT_FREE} is GST-free, which is the figure
        a BAS actually needs.
      </p>
    </div>
  );
}
