'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/design/site/icons';

import type { SearchableTopic } from './_data';

export function SupportSearch({ index }: { index: SearchableTopic[] }) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index.filter(
      (topic) =>
        topic.q.toLowerCase().includes(q) ||
        topic.a.toLowerCase().includes(q) ||
        topic.category.toLowerCase().includes(q),
    );
  }, [query, index]);

  return (
    <div>
      <label htmlFor="support-search" className="sr-only">
        Search support topics
      </label>
      <div className="sup-search">
        <Icon name="search" size={22} />
        <input
          id="support-search"
          type="search"
          placeholder="Search help: “duplicate receipt”, “ABN”, “credits”…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      {query.trim() ? (
        <div className="mt-5 flex flex-col gap-3" role="region" aria-label="Search results">
          {results.length === 0 ? (
            <p className="small text-center">
              No topic matches &quot;{query}&quot;. Browse the categories below, or{' '}
              <a href="#contact" className="font-semibold text-[var(--s-blue-text)] hover:underline">
                contact support
              </a>
              .
            </p>
          ) : (
            results.map((topic, i) => (
              <a key={i} href={topic.categoryHref} className="sup-result">
                <span className="block text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--s-blue-text)]">
                  {topic.category}
                </span>
                <span className="mt-1 block text-[1.0625rem] font-semibold tracking-[-0.015em] text-[var(--s-ink)]">
                  {topic.q}
                </span>
                <span className="small mt-1 block">{topic.a}</span>
              </a>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
