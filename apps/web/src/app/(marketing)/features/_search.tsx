'use client';

import { useId, useState } from 'react';

import { aud } from '@/design/site';
import { RECEIPTS } from '@/design/site/demo';
import { Icon, type IconName } from '@/design/site/icons';

const CATEGORY_ICON: Record<string, IconName> = {
  Fuel: 'fuel',
  Groceries: 'cart',
  'Eating out': 'coffee',
  'Tools & gear': 'tool',
};

/**
 * Search the demo records by merchant, category or amount — the three things
 * the app's own search box takes. It filters the five demo receipts; it is a
 * picture of the behaviour, not a data connection, and says so in its count.
 */
export function RecordSearch() {
  const [query, setQuery] = useState('');
  const inputId = useId();

  const q = query.trim().toLowerCase().replace(/^\$/, '');
  const shown = q
    ? RECEIPTS.filter(
        (r) => r.merchant.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || r.amount.includes(q),
      )
    : RECEIPTS;

  const sample = RECEIPTS[2]?.amount ?? '';
  const suggestions = ['Fuel', 'Groceries', sample].filter(Boolean);

  return (
    <div className="card p-4 sm:p-5">
      <label htmlFor={inputId} className="sr-only">
        Search the demo receipts by merchant, category or amount
      </label>
      <div className="feat-search flex h-[52px] items-center gap-3 rounded-[16px] border border-[var(--s-edge-2)] bg-[var(--s-mist)] px-4 transition-[border-color,box-shadow] duration-200">
        <Icon name="search" size={19} className="shrink-0 text-[var(--s-ink-4)]" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant, category or amount"
          autoComplete="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-[1rem] tracking-[-0.01em] text-[var(--s-ink)] placeholder:text-[var(--s-ink-4)]"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="small mr-1">Try</span>
        {suggestions.map((s) => (
          <button key={s} type="button" className="feat-chip" onClick={() => setQuery(s)}>
            {/^\d/.test(s) ? aud(s) : s}
          </button>
        ))}
        {query ? (
          <button type="button" className="feat-chip" onClick={() => setQuery('')}>
            Clear
          </button>
        ) : null}
      </div>

      <p className="small mt-4 px-1" aria-live="polite">
        {shown.length} of the latest {RECEIPTS.length} receipts
      </p>

      {shown.length > 0 ? (
        <ul className="mt-2 divide-y divide-[var(--s-edge)]">
          {shown.map((r) => (
            <li key={r.merchant} className="flex items-center gap-3.5 px-1 py-3">
              <span
                aria-hidden
                className="grid size-11 shrink-0 place-items-center rounded-full"
                style={{ background: `color-mix(in srgb, ${r.hue} 16%, transparent)`, color: r.hue }}
              >
                <Icon name={CATEGORY_ICON[r.category] ?? 'tag'} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[1rem] font-[620] tracking-[-0.015em]">{r.merchant}</span>
                <span className="block text-[0.8125rem] text-[var(--s-ink-3)]">
                  {r.category} · {r.date}
                </span>
              </span>
              <span className="figure text-[1.0625rem] font-[650]">{aud(r.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 rounded-[16px] bg-[var(--s-mist)] px-5 py-8 text-center">
          <p className="text-[1rem] font-[620] tracking-[-0.015em]">Nothing matches “{query.trim()}”</p>
          <p className="small mt-1">Try a merchant, a category or an amount.</p>
        </div>
      )}
    </div>
  );
}
