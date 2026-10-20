'use client';

import { useEffect, useState } from 'react';

/**
 * "On this page", with the section being read highlighted.
 *
 * The list is hand-written per page (each `id` must match a heading's `id`
 * in the same page, so a renamed heading cannot drift silently); this island
 * only adds the active state, using an IntersectionObserver rather than a
 * scroll listener. Without JS the links still jump to their sections.
 */
export function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const targets = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        // The topmost heading inside the reading band wins.
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-96px 0px -68% 0px', threshold: 0 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  if (items.length === 0) return null;
  return (
    <nav aria-label="On this page" className="docs-toc">
      <div className="docs-side-title">On this page</div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? 'location' : undefined}
              onClick={() => setActive(item.id)}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
