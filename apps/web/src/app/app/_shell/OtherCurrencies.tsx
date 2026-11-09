import type { CurrencyTotal } from '@snap/api-contract';

import { Money } from '@/design/primitives';

/**
 * Receipts in a currency other than the workspace's. They are never added to
 * the figures on the page (two currencies do not sum), so they are shown here
 * instead, one total per currency, rather than silently left out.
 */
export function OtherCurrencies({ totals }: { totals?: CurrencyTotal[] }) {
  if (!totals?.length) return null;
  return (
    <p className="text-[13px] text-[var(--color-ink-muted)]">
      Not counted above, in another currency:{' '}
      {totals.map((t, i) => (
        <span key={t.currency}>
          {i > 0 ? ', ' : ''}
          <Money amount={t.total} currency={t.currency} className="text-[var(--color-ink)]" /> ({t.count} receipt
          {t.count === 1 ? '' : 's'})
        </span>
      ))}
    </p>
  );
}
