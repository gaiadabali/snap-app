'use client';

import { useState } from 'react';

import { Card } from '@/design/primitives';

/**
 * Illustrative firm-cost estimator for the two Practice plans.
 *
 * This is marketing copy, not a billed amount from the API — there is no
 * server total to fetch (Stripe is unbuilt, docs/WEB.md §7). To keep the same
 * discipline the rest of the site holds for money, the math here is still
 * done in integer CENTS, never floats, and never `parseFloat` on a string —
 * see `centsToDisplay` below. $19.00 and $29.00 are the only literals; they
 * come straight from docs/MONETISATION.md §3 and must not drift from there.
 */

const PRACTICE_CENTS = 1900;
const PRACTICE_PLUS_CENTS = 2900;
const MIN_CLIENTS = 10;

function centsToDisplay(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const wholeStr = String(Math.trunc(abs / 100));
  const centsStr = String(abs % 100).padStart(2, '0');
  const grouped = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}$${grouped}.${centsStr}`;
}

export function PracticeEstimator() {
  const [clients, setClients] = useState(MIN_CLIENTS);

  const practiceTotal = centsToDisplay(clients * PRACTICE_CENTS);
  const practicePlusTotal = centsToDisplay(clients * PRACTICE_PLUS_CENTS);

  return (
    <Card tone="ground" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold text-[var(--color-ink)]">
            Estimate your firm&apos;s monthly cost
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            10-client minimum on both plans. Drag to your client count.
          </p>
        </div>
        <div className="tabular text-[13px] font-semibold text-[var(--color-ink)]">
          {clients} client{clients === 1 ? '' : 's'}
        </div>
      </div>
      <input
        type="range"
        min={MIN_CLIENTS}
        max={250}
        step={1}
        value={clients}
        onChange={(e) => setClients(Number(e.target.value))}
        className="mt-4 w-full accent-[var(--color-accent)]"
        aria-label="Number of clients"
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            Practice
          </div>
          <div className="mt-1 text-2xl font-bold tabular text-[var(--color-ink)]">
            {practiceTotal}
            <span className="text-[14px] font-medium text-[var(--color-ink-muted)]">/mo</span>
          </div>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            Practice Plus
          </div>
          <div className="mt-1 text-2xl font-bold tabular text-[var(--color-ink)]">
            {practicePlusTotal}
            <span className="text-[14px] font-medium text-[var(--color-ink-muted)]">/mo</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
