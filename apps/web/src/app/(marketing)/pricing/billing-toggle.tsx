'use client';

import { useState } from 'react';

import { cx } from '@/design/primitives';

export type BillingPeriod = 'monthly' | 'annual';

/**
 * Pure UI state — which of two pre-computed figures to show. No money math
 * happens here or anywhere on the client; every dollar figure this toggle
 * reveals is a fixed string authored in page.tsx, per docs/WEB.md §3.2.
 */
export function BillingToggle({
  onChange,
}: {
  onChange?: (period: BillingPeriod) => void;
}) {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

  function select(next: BillingPeriod) {
    setPeriod(next);
    onChange?.(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] p-1"
    >
      {(
        [
          { key: 'monthly', label: 'Monthly' },
          { key: 'annual', label: 'Annual — 2 months free' },
        ] as const
      ).map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={period === opt.key}
          onClick={() => select(opt.key)}
          className={cx(
            'rounded-full px-4 py-2 text-[13px] font-semibold transition-colors duration-150',
            period === opt.key
              ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
