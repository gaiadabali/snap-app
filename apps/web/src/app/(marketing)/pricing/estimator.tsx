'use client';

import { useId, useState } from 'react';

import { aud } from '@/design/site';
import { SPENDING } from '@/design/site/demo';

import { CREDIT_PACKS, FREE_SCANS_AT_SIGNUP } from './credit-packs';
import { CENTS_PER_SCAN, centsToAmount, scansCostCents } from './figures';

/**
 * "What would my month cost?" A slider, three totals and a row that says how
 * long each pack lasts at that pace.
 *
 * All arithmetic is whole numbers: scans are integers, the rate is tenths of a
 * cent (figures.ts) and totals are whole cents, formatted by `aud()` from a
 * decimal string. Nothing here parses or multiplies a float.
 *
 * The free scans come off the first month only — they are granted once, they
 * do not reset (see the FAQ). Pack lengths ignore them: they are a separate
 * allowance, spent first.
 *
 * Keyboard: it is a native `<input type="range">`, so arrows, Home/End and
 * Page keys work. Its `aria-valuetext` carries the answer, so a screen reader
 * hears the month's cost as the value changes rather than a bare number.
 */

const MIN_RECEIPTS = 5;
const MAX_RECEIPTS = 300;
/** The demo household's October, so the first thing shown is a real month. */
const START_RECEIPTS = Math.min(MAX_RECEIPTS, Math.max(MIN_RECEIPTS, SPENDING.receipts));

const MONTHS_IN_YEAR = 12;

function money(cents: number): string {
  return aud(centsToAmount(cents));
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** How long `credits` lasts at `perMonth` scans a month, in words. */
function lastsFor(credits: number, perMonth: number): string {
  const months = Math.floor(credits / perMonth);
  if (months < 1) return 'Under a month';
  if (months >= MONTHS_IN_YEAR * 2) return `${Math.floor(months / MONTHS_IN_YEAR)}+ years`;
  return `${months} ${plural(months, 'month', 'months')}`;
}

export function Estimator() {
  const id = useId();
  const [receipts, setReceipts] = useState<number>(START_RECEIPTS);

  const steady = scansCostCents(receipts);
  const firstMonth = scansCostCents(receipts - FREE_SCANS_AT_SIGNUP);
  const yearScans = receipts * MONTHS_IN_YEAR;
  const year = scansCostCents(yearScans - FREE_SCANS_AT_SIGNUP);
  const covered = receipts <= FREE_SCANS_AT_SIGNUP;

  const fill = Math.round(((receipts - MIN_RECEIPTS) * 100) / (MAX_RECEIPTS - MIN_RECEIPTS));

  const smallest = CREDIT_PACKS[0];
  const bestIndex = CREDIT_PACKS.findIndex((p) => Math.floor(p.credits / receipts) >= MONTHS_IN_YEAR);
  const best = bestIndex >= 0 ? CREDIT_PACKS[bestIndex] : undefined;

  return (
    <div className="card rounded-[32px]">
      <div className="grid lg:grid-cols-[1fr_1.05fr]">
        {/* ── The question ──────────────────────────────────────────────── */}
        <div className="p-7 sm:p-10">
          <label htmlFor={id} className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            Receipts you scan in a month
          </label>

          <div className="mt-3 flex items-baseline gap-3">
            <span className="figure text-[clamp(4rem,8vw,5.5rem)] leading-none font-[650]">{receipts}</span>
            <span className="text-[1.0625rem] text-[var(--s-ink-3)]">{plural(receipts, 'receipt', 'receipts')}</span>
          </div>

          <div className="mt-6">
            <input
              id={id}
              type="range"
              className="price-range"
              min={MIN_RECEIPTS}
              max={MAX_RECEIPTS}
              step={1}
              value={receipts}
              onChange={(e) => setReceipts(Number(e.target.value))}
              style={{ ['--fill' as string]: `${fill}%` }}
              aria-valuetext={`${receipts} ${plural(receipts, 'receipt', 'receipts')} a month, ${money(steady)} a month`}
            />
            <div className="mt-1 flex justify-between text-[0.8125rem] text-[var(--s-ink-4)]" aria-hidden>
              <span>{MIN_RECEIPTS}</span>
              <span>{MAX_RECEIPTS}</span>
            </div>
          </div>

          <p className="small mt-8 max-w-[38ch]">
            The demo household scanned {SPENDING.receipts} in October. Drag to your own month.
          </p>
        </div>

        {/* ── The answer ────────────────────────────────────────────────── */}
        <div className="border-t border-[var(--s-edge)] bg-[var(--s-mist)] p-7 sm:p-10 lg:border-t-0 lg:border-l">
          <div className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--s-ink-3)]">Every month</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="figure text-[clamp(3rem,6vw,4.25rem)] leading-none font-[650]">{money(steady)}</span>
          </div>
          <div className="small mt-2">
            {receipts} × {CENTS_PER_SCAN}¢
          </div>

          <dl className="mt-8 divide-y divide-[var(--s-edge)] border-y border-[var(--s-edge)]">
            <div className="flex items-baseline justify-between gap-6 py-4">
              <div>
                <dt className="text-[0.9375rem] font-semibold tracking-[-0.01em]">First month</dt>
                <dd className="small mt-0.5">
                  {covered
                    ? 'Your free scans cover all of it.'
                    : `Your ${FREE_SCANS_AT_SIGNUP} free scans come off first.`}
                </dd>
              </div>
              <span className="figure text-[1.5rem] font-[650]">{money(firstMonth)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-6 py-4">
              <div>
                <dt className="text-[0.9375rem] font-semibold tracking-[-0.01em]">First year</dt>
                <dd className="small mt-0.5">
                  {yearScans} scans, less the free ones.
                </dd>
              </div>
              <span className="figure text-[1.5rem] font-[650]">{money(year)}</span>
            </div>
          </dl>

          {smallest ? (
            <p className="small mt-5 max-w-[46ch]">
              Credits are bought in packs, the smallest being {smallest.credits} scans for {aud(smallest.priceAud)}.
              These totals are the rate times your scans.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Which pack covers how long ──────────────────────────────────── */}
      <div className="border-t border-[var(--s-edge)] p-7 sm:p-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="hd-4">How long a pack lasts at {receipts} a month</h3>
          <p className="small">
            {best
              ? `The ${best.credits.toLocaleString('en-AU')}-scan pack covers a year of this.`
              : 'At this pace, a year takes more than one pack.'}
          </p>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-5">
          {CREDIT_PACKS.map((p, i) => {
            const pct = Math.min(100, Math.floor((p.credits * 100) / (receipts * MONTHS_IN_YEAR)));
            return (
              <li
                key={p.credits}
                className="price-lasts grid grid-cols-[6.25rem_1fr_auto] items-center gap-x-4 rounded-[18px] border border-[var(--s-edge)] px-4 py-3.5 sm:block sm:px-4 sm:py-4"
                data-best={i === bestIndex ? '' : undefined}
              >
                <div>
                  <div className="figure text-[1.125rem] font-[650]">{p.credits.toLocaleString('en-AU')}</div>
                  <div className="text-[0.8125rem] text-[var(--s-ink-3)]">scans · {aud(p.priceAud)}</div>
                </div>
                <div className="price-fillbar sm:mt-4" aria-hidden>
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="text-right text-[0.9375rem] font-semibold tracking-[-0.01em] sm:mt-3 sm:text-left">
                  {lastsFor(p.credits, receipts)}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
