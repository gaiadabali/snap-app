import { Badge, Money, cx } from '@/design/primitives';

/**
 * The one visual that carries `.scan-line` — reserved for capture and
 * extraction imagery per docs/WEB.md §4. A stylised, plausible AU tax
 * invoice (a fictional supplier; the ABN shape is illustrative, not a real
 * registration), not a stock photo of a receipt.
 */
function Row({
  label,
  amount,
  bold = false,
}: {
  label: string;
  amount: string;
  bold?: boolean;
}) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4', bold && 'font-semibold')}>
      <span className={cx(bold ? 'text-[var(--color-ink)]' : undefined)}>{label}</span>
      <Money amount={amount} className={bold ? 'text-[var(--color-ink)]' : undefined} />
    </div>
  );
}

export function ReceiptScanCard({ className, scanning = true }: { className?: string; scanning?: boolean }) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-rule-strong)]',
        'bg-[var(--color-surface)] shadow-[var(--shadow-lift)]',
        scanning && 'scan-line',
        className,
      )}
    >
      <div className="border-b border-dashed border-[var(--color-rule)] px-5 pb-4 pt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
          Tax invoice · captured 12 Jun 2026, 7:41am
        </div>
        <div className="mt-1 text-[16px] font-bold text-[var(--color-ink)]">Ironbark Trade Supplies</div>
        <div className="font-mono text-[12px] text-[var(--color-ink-muted)]">ABN 84 731 502 664</div>
      </div>

      <div className="space-y-1.5 px-5 py-4 font-mono text-[13px] text-[var(--color-ink-muted)]">
        <Row label="2 × Treated pine sleeper" amount="34.00" />
        <Row label="1 × Impact driver bit set" amount="28.95" />
        <Row label="1 × Safety glasses" amount="12.50" />
        <div className="my-2 border-t border-dashed border-[var(--color-rule)]" />
        <Row label="Subtotal" amount="75.00" />
        <Row label="GST" amount="7.50" />
        <Row label="Total" amount="82.50" bold />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-rule)] bg-[var(--color-ground)] px-5 py-3">
        <Badge tone="good">Auto-accepted</Badge>
        <span className="text-[12px] text-[var(--color-ink-muted)]">9/9 validators passed · G11 · 1B</span>
      </div>
    </div>
  );
}
