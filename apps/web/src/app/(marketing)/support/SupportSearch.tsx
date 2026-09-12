'use client';

import { useMemo, useState } from 'react';

import { Card, Input } from '@/design/primitives';

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
      <Input
        id="support-search"
        type="search"
        placeholder="Search support topics — “Xero”, “unclaimable GST”, “duplicate receipt”…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full"
      />
      {query.trim() ? (
        <div className="mt-4 flex flex-col gap-3">
          {results.length === 0 ? (
            <p className="text-[14px] text-[var(--color-ink-muted)]">
              No topic matches &quot;{query}&quot;. Browse the categories below, or{' '}
              <a href="#contact" className="text-[var(--color-accent)] hover:underline">
                contact support
              </a>
              .
            </p>
          ) : (
            results.map((topic, i) => (
              <a key={i} href={topic.categoryHref} className="block">
                <Card interactive className="flex flex-col gap-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent)]">
                    {topic.category}
                  </div>
                  <div className="text-[15px] font-semibold text-[var(--color-ink)]">{topic.q}</div>
                  <div className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{topic.a}</div>
                </Card>
              </a>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
