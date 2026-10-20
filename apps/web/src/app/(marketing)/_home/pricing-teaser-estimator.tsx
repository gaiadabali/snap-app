'use client';

import { useId, useState } from 'react';

import { aud } from '@/design/site';

import { CREDIT_PRICE_AUD, FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

import './pricing-teaser-styles.css';

/**
 * "What would a month cost me?" A range slider and one honest number.
 *
 * The arithmetic is integer end to end (docs/WEB.md §3.2). The price of a scan
 * is held in tenths of a cent (3.7c is 37), a month is receipts × 37 tenths,
 * and only the final step rounds to whole cents for display. No float is ever
 * multiplied by a count.
 *
 * The first scans are free ONCE, at signup, so they are mentioned rather than
 * subtracted: the figure is what a steady month costs.
 *
 * Native range input: arrow keys, Home/End, PageUp/PageDown, touch and screen
 * readers come with it. Nothing here animates in a way reduced motion could
 * object to; the number simply changes.
 */

const MIN = 5;
const MAX = 300;
const START = 40;

/** One scan, in tenths of a cent. 0.037 dollars is 37. */
const TENTHS_PER_SCAN = Math.round(CREDIT_PRICE_AUD * 1000);

/** The same rate as the section headline prints it: "3.7". */
const RATE_CENTS = (CREDIT_PRICE_AUD * 100).toFixed(1);

/** Receipts → a dollars string ("1.48") by whole cents, from integer tenths. */
function monthly(receipts: number): string {
  const tenths = receipts * TENTHS_PER_SCAN;
  const cents = Math.round(tenths / 10);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function PricingEstimator() {
  const id = useId();
  const [receipts, setReceipts] = useState(START);
  const cost = aud(monthly(receipts));
  const p = (receipts - MIN) / (MAX - MIN);

  return (
    <div className="card grid md:grid-cols-[1.25fr_1fr]">
      <div className="p-7 sm:p-9">
        <div className="flex items-end justify-between gap-4">
          <label htmlFor={id} className="text-[1rem] font-[600] tracking-[-0.015em] text-[var(--s-ink)]">
            Receipts a month
          </label>
          <span className="figure text-[2.25rem] font-[650] leading-none text-[var(--s-ink)]" aria-hidden>
            {receipts}
          </span>
        </div>

        <input
          id={id}
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          value={receipts}
          onChange={(e) => setReceipts(Number(e.target.value))}
          aria-valuetext={`${receipts} receipts a month, ${cost} a month`}
          className="pricing-teaser-range mt-6"
          style={{ ['--p' as string]: p }}
        />

        <div className="mt-1 flex justify-between text-[0.8125rem] text-[var(--s-ink-3)]" aria-hidden>
          <span>{MIN}</span>
          <span>{MAX}</span>
        </div>

        <p className="mt-6 text-[0.875rem] leading-relaxed text-[var(--s-ink-3)]">
          Your first {FREE_SCANS_AT_SIGNUP} scans are free, once, when you sign up. After that a
          scan is one credit.
        </p>
      </div>

      <div className="flex flex-col justify-center border-t border-[var(--s-edge)] bg-[var(--s-blue-soft)] p-7 sm:p-9 md:border-l md:border-t-0">
        <p className="text-[0.875rem] font-[600] text-[var(--s-blue-text)]">Your month</p>
        <output
          htmlFor={id}
          className="figure mt-2 block text-[clamp(2.75rem,6vw,4rem)] font-[650] leading-none text-[var(--s-ink)]"
        >
          {cost}
        </output>
        <p className="mt-4 text-[0.875rem] leading-relaxed text-[var(--s-ink-2)]">
          {receipts} scans at {RATE_CENTS}¢ each, GST included. Skip a month and it costs nothing.
        </p>
      </div>
    </div>
  );
}
