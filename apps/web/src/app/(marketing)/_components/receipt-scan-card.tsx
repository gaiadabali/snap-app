import { Money, cx } from '@/design/primitives';

/**
 * The hero artefact: one docket becoming one balanced ledger entry.
 *
 * This is the product in a single image, so it is drawn rather than
 * photographed — a stock photo of a receipt would say "we scan receipts",
 * which is the claim we are specifically arguing against. What matters is the
 * right-hand column: three splits that sum to exactly 0.00.
 *
 * The figures reconcile. 75.00 + 7.50 = 82.50, and the credit to the card is
 * the same 82.50 back out. Fake-looking data makes a real product look fake
 * (docs/WEB.md §4), and a worked example that does not actually balance would
 * be the worst possible thing to put at the top of this particular page.
 *
 * `.scan-line` is the teaser's motif and stays reserved for capture imagery.
 * The stagger runs on `--i` against a load animation, not a scroll timeline,
 * because this sits above the fold and has no entry to animate against.
 */

const DOCKET_LINES = [
  { label: '2 × Pine sleeper', amount: '34.00' },
  { label: '1 × Driver bit set', amount: '28.95' },
  { label: '1 × Safety glasses', amount: '12.50' },
] as const;

const SPLITS = [
  { account: 'Tools & Equipment', kind: 'expense', amount: '75.00', code: '' },
  { account: 'GST Receivable', kind: 'asset', amount: '7.50', code: '1B' },
  { account: 'Credit Card', kind: 'liability', amount: '-82.50', code: '' },
] as const;

function DocketRow({ label, amount, i }: { label: string; amount: string; i: number }) {
  return (
    <div
      className="anim-load flex items-baseline justify-between gap-4"
      style={{ ['--i' as string]: i }}
    >
      <span className="whitespace-nowrap">{label}</span>
      <Money amount={amount} className="shrink-0" />
    </div>
  );
}

export function ReceiptScanCard({
  className,
  scanning = true,
}: {
  className?: string;
  scanning?: boolean;
}) {
  return (
    /**
     * A container query, not a viewport one.
     *
     * This card is dropped into slots of very different widths — a wide hero
     * column on the home page, a ~360px aside on /features. A `sm:` breakpoint
     * asks the wrong question (how big is the window) and cramps the two-column
     * split into a narrow aside. `@container` asks the right one: how much room
     * do *I* actually have.
     */
    <div className={cx('@container', className)}>
      <div
        className={cx(
          'grid overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule-strong)]',
          'bg-[var(--color-ground)] @md:grid-cols-2',
        )}
      >
        {/* ── Left: the captured docket ─────────────────────────────────── */}
        <div
          className={cx(
            'relative overflow-hidden border-b border-[var(--color-rule)] p-6 @md:border-b-0 @md:border-r',
            scanning && 'scan-line',
          )}
        >
        <div className="t-label text-[var(--color-ink-faint)]">Captured</div>
        <div className="anim-load mt-4 text-[15px] font-medium text-[var(--color-ink)]">
          Ironbark Trade Supplies
        </div>
        <div className="anim-load font-mono text-[12px] text-[var(--color-ink-muted)]">
          ABN 84 731 502 664
        </div>

        <div className="my-4 border-t border-dashed border-[var(--color-rule-strong)]" />

        <div className="space-y-2 font-mono text-[12.5px] text-[var(--color-ink-muted)]">
          {DOCKET_LINES.map((line, i) => (
            <DocketRow key={line.label} label={line.label} amount={line.amount} i={i + 1} />
          ))}
        </div>

        <div className="my-4 border-t border-dashed border-[var(--color-rule-strong)]" />

        <div className="space-y-2 font-mono text-[12.5px] text-[var(--color-ink-muted)]">
          <DocketRow label="Subtotal" amount="75.00" i={4} />
          <DocketRow label="GST" amount="7.50" i={5} />
          <div
            className="anim-load flex items-baseline justify-between gap-4 pt-1 font-medium text-[var(--color-ink)]"
            style={{ ['--i' as string]: 6 }}
          >
            <span>Total</span>
            <Money amount="82.50" />
          </div>
        </div>
      </div>

      {/* ── Right: the posted entry ───────────────────────────────────── */}
      <div className="bg-[var(--color-surface)] p-6">
        <div className="t-label text-[var(--color-ink-faint)]">Posted</div>

        <div className="mt-4 divide-y divide-[var(--color-rule)]">
          {SPLITS.map((split, i) => (
            <div
              key={split.account}
              className="anim-load flex items-baseline justify-between gap-3 py-2.5"
              style={{ ['--i' as string]: i + 7 }}
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] text-[var(--color-ink)]">
                  {split.account}
                </span>
                <span className="text-[11.5px] text-[var(--color-ink-faint)]">{split.kind}</span>
              </span>
              <Money
                amount={split.amount}
                className="shrink-0 font-mono text-[13px] text-[var(--color-ink-muted)]"
              />
            </div>
          ))}
        </div>

        {/* The punchline. Everything above exists to make this number true. */}
        <div
          className="anim-load mt-4 flex items-baseline justify-between gap-3 border-t-2 border-[var(--color-ink)] pt-3"
          style={{ ['--i' as string]: 10 }}
        >
          <span className="text-[13px] font-medium text-[var(--color-ink)]">Sum of splits</span>
          <Money amount="0.00" className="font-mono text-[18px] font-medium text-[var(--color-good)]" />
        </div>

        <div
          className="anim-load mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--color-ink-muted)]"
          style={{ ['--i' as string]: 11 }}
        >
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-good)]" aria-hidden />
          <span>9 / 9 validators passed</span>
          <span aria-hidden className="text-[var(--color-rule-strong)]">·</span>
          <span className="font-mono">G11</span>
          <span aria-hidden className="text-[var(--color-rule-strong)]">·</span>
          <span className="font-mono">1B</span>
          </div>
        </div>
      </div>
    </div>
  );
}
